"""
AutoOps Orchestrator — LangGraph Graph Definition
===================================================
Contains:
  • 13 node functions (node_ingestion fully implemented; others stubbed)
  • 3 deterministic router functions (pure Python branching)
  • Full graph topology wired via StateGraph

Node names, edge topology, and conditional-routing logic match the
architectural specification exactly.
"""

from __future__ import annotations

import json
import hmac
import hashlib
import logging
import os
from typing import Dict, Any, Literal

from groq import Groq
import resend
from langgraph.graph import StateGraph, START, END

from state_schema import AutoOpsState

# ---------------------------------------------------------------------------
# Module-level clients
# ---------------------------------------------------------------------------

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY", "dummy_key"))
resend.api_key = os.getenv("RESEND_API_KEY", "dummy_key")

logger = logging.getLogger("autoops.graph")


# ---------------------------------------------------------------------------
# ROUTER FUNCTIONS — pure deterministic Python, NO natural language
# ---------------------------------------------------------------------------

def confidence_router(state: AutoOpsState) -> str:
    """Route after node_ingestion based on payload_confidence and integrity.

    Decision matrix
    ---------------
    • confidence < 0.5 OR integrity failed  → "END"                (reject)
    • 0.5 ≤ confidence < 0.8                → "node_hitl_escalation" (human review)
    • confidence ≥ 0.8                      → "node_rag_retrieval"   (proceed)
    """
    confidence = state.get("payload_confidence", 0.0)
    integrity = state.get("integrity_check_passed", False)

    if confidence < 0.5 or not integrity:
        return "END"
    if confidence < 0.8:
        return "node_hitl_escalation"
    return "node_rag_retrieval"


def plan_router(state: AutoOpsState) -> Literal["advance", "loop", "escalate"]:
    """Route after node_meta_governance based on governance decision.

    Decision matrix
    ---------------
    • routing == 'advance'                          → "advance"
    • routing == 'loop' AND iteration_count < 5     → "loop"
    • routing == 'loop' AND iteration_count >= 5    → "escalate"
    • routing == 'escalate'                         → "escalate"
    """
    routing = state["meta_governance_decision"].get("routing", "escalate")
    if routing == "advance":
        return "advance"
    if routing == "loop":
        if state["iteration_count"] < 5:
            return "loop"
        return "escalate"
    # Default: escalate
    return "escalate"


def execution_router(state: AutoOpsState) -> Literal["feedback", "retry", "hitl"]:
    """Route after node_execution based on execution outcome.

    Decision matrix
    ---------------
    • all systems succeeded              → "feedback"
    • a system failed AND retry_count < 2 → "retry"
    • a system failed AND retry_count ≥ 2 → "hitl"
    """
    receipt = state.get("execution_receipt", {})
    all_succeeded = receipt.get("all_succeeded", False)
    retry_count = receipt.get("retry_count", 0)

    if all_succeeded:
        return "feedback"
    if retry_count < 2:
        return "retry"
    return "hitl"


# ---------------------------------------------------------------------------
# NODE FUNCTIONS — stubbed, correct AutoOpsState signatures
# ---------------------------------------------------------------------------

def node_ingestion(state: AutoOpsState) -> Dict[str, Any]:
    """Parse raw payload, validate HMAC, extract hire profile via Groq LLM,
    and compute a multi-factor payload_confidence score.

    Steps
    -----
    1. Extract ``payload_type`` from the raw payload.
    2. Validate HMAC-SHA256 webhook signature (if headers present).
    3. Call Groq ``llama3-8b-8192`` to extract structured hire profile.
    4. Compute ``payload_confidence`` (0.0–1.0) from completeness,
       structural coherence, and an MCP mock validation bonus.
    5. Return partial state update.
    """
    raw_payload = state.get("raw_payload", {})

    # ── Step 1: Extract payload_type ───────────────────────────────────
    payload_type = raw_payload.get("type", "onboarding")

    # ── Step 2: HMAC-SHA256 signature validation ──────────────────────
    headers = raw_payload.get("headers", None)
    body = raw_payload.get("body", raw_payload)

    if headers is None:
        # Hackathon local testing: no headers → default to passing
        integrity_check_passed = True
    else:
        received_signature = headers.get("x-webhook-signature", "")
        webhook_secret = os.getenv("WEBHOOK_SECRET", "default_secret")
        body_bytes = json.dumps(body, sort_keys=True).encode("utf-8")
        expected_signature = hmac.new(
            webhook_secret.encode("utf-8"),
            body_bytes,
            hashlib.sha256,
        ).hexdigest()
        integrity_check_passed = hmac.compare_digest(
            received_signature, expected_signature
        )

    # ── Step 3: Groq LLM extraction ───────────────────────────────────
    extraction_prompt = (
        "You are a structured-data extraction engine.\n"
        "Given the following raw JSON payload, extract EXACTLY these keys "
        "into a valid JSON object. If a value is missing, use an empty string.\n\n"
        "Keys: name, role, department, seniority, employment_type, "
        "start_date, manager, required_systems, compliance_flags\n\n"
        f"Raw payload:\n```json\n{json.dumps(body, indent=2)}\n```\n\n"
        "Respond ONLY with the JSON object. No explanation."
    )

    hire_profile: Dict[str, Any] = {}
    payload_confidence: float = 0.0

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": "You are a JSON extraction assistant. "
                               "Always respond with valid JSON only.",
                },
                {"role": "user", "content": extraction_prompt},
            ],
            model="llama3-8b-8192",
            temperature=0.0,
            max_tokens=1024,
        )

        raw_response = chat_completion.choices[0].message.content.strip()

        # Strip markdown fences if present
        if raw_response.startswith("```"):
            lines = raw_response.split("\n")
            # Remove first and last fence lines
            lines = [l for l in lines if not l.strip().startswith("```")]
            raw_response = "\n".join(lines)

        hire_profile = json.loads(raw_response)
        logger.info("Groq extraction succeeded: %s", list(hire_profile.keys()))

    except json.JSONDecodeError as exc:
        logger.warning("Failed to parse Groq JSON response: %s", exc)
        hire_profile = {}
        payload_confidence = 0.0
    except Exception as exc:
        logger.warning("Groq API call failed: %s", exc)
        hire_profile = {}
        payload_confidence = 0.0

    # ── Step 4: Calculate payload_confidence ───────────────────────────
    if hire_profile:
        expected_keys = [
            "name", "role", "department", "seniority",
            "employment_type", "start_date", "manager",
            "required_systems", "compliance_flags",
        ]

        # Completeness: up to 0.4
        populated = sum(
            1 for k in expected_keys
            if hire_profile.get(k) not in (None, "", [], {})
        )
        completeness_score = (populated / len(expected_keys)) * 0.4

        # Structural coherence: up to 0.2
        coherence_score = 0.0
        if hire_profile.get("start_date", ""):
            coherence_score += 0.1
        if hire_profile.get("employment_type", "") in (
            "full_time", "contractor", "probationary"
        ):
            coherence_score += 0.1

        # MCP mock validation bonus: 0.4 (mock HR DB check)
        mcp_mock_score = 0.4

        payload_confidence = min(
            completeness_score + coherence_score + mcp_mock_score, 1.0
        )

    logger.info(
        "node_ingestion complete: type=%s, confidence=%.2f, integrity=%s",
        payload_type, payload_confidence, integrity_check_passed,
    )

    # ── Step 5: Return partial state ──────────────────────────────────
    return {
        "payload_type": payload_type,
        "integrity_check_passed": integrity_check_passed,
        "hire_profile": hire_profile,
        "payload_confidence": payload_confidence,
    }


def node_rag_retrieval(state: AutoOpsState) -> Dict[str, Any]:
    """Look up historical_context via RAG, set similarity_gate_passed.

    STUB: Returns NULL_CONTEXT sentinel.
    """
    # TODO: Implement vector-store retrieval
    return {
        "historical_context": "NULL_CONTEXT",
        "similarity_gate_passed": False,
    }


def node_plan_generation(state: AutoOpsState) -> Dict[str, Any]:
    """Generate proposed_plan and increment iteration_count.

    STUB: Returns an empty plan and bumps the counter.
    """
    # TODO: Implement LLM-based plan generation
    return {
        "proposed_plan": {},
        "reflection_passed": False,
        "iteration_count": state.get("iteration_count", 0) + 1,
    }


def node_security_guard(state: AutoOpsState) -> Dict[str, Any]:
    """Evaluate proposed_plan from a security perspective.

    STUB: Returns neutral feedback and appends an audit entry.
    """
    # TODO: Implement security policy evaluation
    feedback = {"guard": "security", "passed": True, "issues": []}
    return {
        "security_feedback": feedback,
        "audit_feedback": [{"guard": "security", "result": feedback}],
    }


def node_hr_guard(state: AutoOpsState) -> Dict[str, Any]:
    """Evaluate proposed_plan from an HR compliance perspective.

    STUB: Returns neutral feedback and appends an audit entry.
    """
    # TODO: Implement HR policy evaluation
    feedback = {"guard": "hr", "passed": True, "issues": []}
    return {
        "hr_feedback": feedback,
        "audit_feedback": [{"guard": "hr", "result": feedback}],
    }


def node_policy_guard(state: AutoOpsState) -> Dict[str, Any]:
    """Evaluate proposed_plan against corporate policy.

    STUB: Returns neutral feedback and appends an audit entry.
    """
    # TODO: Implement corporate policy evaluation
    feedback = {"guard": "policy", "passed": True, "issues": []}
    return {
        "policy_feedback": feedback,
        "audit_feedback": [{"guard": "policy", "result": feedback}],
    }


def node_sla_guard(state: AutoOpsState) -> Dict[str, Any]:
    """Evaluate proposed_plan against SLA / performance requirements.

    STUB: Returns neutral feedback and appends an audit entry.
    """
    # TODO: Implement SLA evaluation
    feedback = {"guard": "sla", "passed": True, "issues": []}
    return {
        "sla_feedback": feedback,
        "audit_feedback": [{"guard": "sla", "result": feedback}],
    }


def node_fan_in_reducer(state: AutoOpsState) -> Dict[str, Any]:
    """Aggregate results from all four guard nodes.

    STUB: Packages the individual guard feedbacks for meta-governance.
    """
    # TODO: Implement real aggregation / conflict resolution
    return {
        "meta_governance_decision": {
            "routing": "advance",
            "guard_summary": {
                "security": state.get("security_feedback", {}),
                "hr": state.get("hr_feedback", {}),
                "policy": state.get("policy_feedback", {}),
                "sla": state.get("sla_feedback", {}),
            },
        },
    }


def node_meta_governance(state: AutoOpsState) -> Dict[str, Any]:
    """Produce the final meta_governance_decision with routing key.

    STUB: Passes through the decision from node_fan_in_reducer.
    """
    # TODO: Implement LLM-based governance reasoning
    return {
        "meta_governance_decision": state.get(
            "meta_governance_decision",
            {"routing": "escalate"},
        ),
    }


def node_execution(state: AutoOpsState) -> Dict[str, Any]:
    """Execute the approved plan against external systems.

    STUB: Returns a mock execution receipt.
    """
    # TODO: Implement actual system calls via MCP tools
    retry_count = state.get("execution_receipt", {}).get("retry_count", 0)
    return {
        "execution_receipt": {
            "all_succeeded": False,
            "retry_count": retry_count,
            "systems": {},
        },
        "execution_log": [
            {
                "event": "execution_attempt",
                "retry_count": retry_count,
                "result": "stub",
            }
        ],
        "zero_shot_success": False,
    }


def node_retry(state: AutoOpsState) -> Dict[str, Any]:
    """Prepare state for a retry of node_execution.

    STUB: Increments the retry counter inside execution_receipt.
    """
    current_receipt = state.get("execution_receipt", {})
    retry_count = current_receipt.get("retry_count", 0) + 1
    return {
        "execution_receipt": {
            **current_receipt,
            "all_succeeded": False,
            "retry_count": retry_count,
        },
        "execution_log": [
            {
                "event": "retry_scheduled",
                "retry_count": retry_count,
            }
        ],
    }


def node_hitl_escalation(state: AutoOpsState) -> Dict[str, Any]:
    """Escalate to human-in-the-loop review via Resend email.

    Steps
    -----
    1. Set ``hitl_status`` to ``'pending'``.
    2. Determine trigger reason from execution state.
    3. Build formatted plain-text email body.
    4. Send email via Resend SDK (or log in demo mode).
    5. Return partial state update.
    """
    # ── Step 1: Set status ────────────────────────────────────────────
    hitl_status = "pending"

    # ── Step 2: Determine trigger reason ──────────────────────────────
    execution_log = state.get("execution_log", [])
    failed_entries = [
        entry for entry in execution_log
        if entry.get("result") in ("stub", "failed", "error")
        or entry.get("event") == "retry_scheduled"
    ]

    confidence = state.get("payload_confidence", 0.0)
    iteration_count = state.get("iteration_count", 0)

    if len(failed_entries) >= 2:
        trigger_reason = "Execution Failure: JIRA provisioning failed 2+ times (503 Service Unavailable)"
    elif 0.5 <= confidence < 0.8:
        trigger_reason = "Low Confidence: Payload confidence score is between 0.5 and 0.8 — manual verification required"
    elif iteration_count >= 5:
        trigger_reason = "Plan Loop Limit: Plan generation exceeded 5 iterations without governance approval"
    else:
        trigger_reason = "High Privilege Access Request or System Anomaly"

    # ── Step 3: Build email body ──────────────────────────────────────
    hire_name = state.get("hire_profile", {}).get("name", "Unknown Hire")
    log_text = json.dumps(execution_log, indent=2) if execution_log else "(no execution log)"

    email_body = (
        f"============================================\n"
        f"  AUTOOPS ORCHESTRATOR — HITL ESCALATION\n"
        f"============================================\n\n"
        f"Hire Name:       {hire_name}\n"
        f"Trigger Reason:  {trigger_reason}\n"
        f"Confidence:      {confidence:.2f}\n"
        f"Iteration Count: {iteration_count}\n"
        f"HITL Status:     {hitl_status}\n\n"
        f"--- Execution Log ---\n"
        f"{log_text}\n\n"
        f"Please review and approve/reject this workflow in the AutoOps dashboard.\n"
    )

    # ── Step 4: Send email via Resend ─────────────────────────────────
    try:
        if resend.api_key != "dummy_key":
            resend.Emails.send({
                "from": "onboarding@resend.dev",
                "to": "itmanager@autoops.demo",
                "subject": f"URGENT: Approval Required for {hire_name}",
                "text": email_body,
            })
            logger.info("HITL escalation email sent for: %s", hire_name)
        else:
            print(f"[DEMO LOG] Would have sent HITL email for: {trigger_reason}")
    except Exception as e:
        print(f"Resend error: {e}")

    # ── Step 5: Return partial state ──────────────────────────────────
    return {
        "hitl_status": hitl_status,
    }


def node_feedback_loop(state: AutoOpsState) -> Dict[str, Any]:
    """Produce the condenser_summary and finalize the workflow.

    STUB: Returns a placeholder summary.
    """
    # TODO: Implement LLM-based summarization
    return {
        "condenser_summary": "Workflow completed. Summary pending LLM implementation.",
    }


# ---------------------------------------------------------------------------
# GRAPH ASSEMBLY — exact topology from the specification
# ---------------------------------------------------------------------------

def build_graph() -> StateGraph:
    """Construct and return the compiled AutoOps StateGraph."""

    graph = StateGraph(AutoOpsState)

    # ── Register all 13 nodes ──────────────────────────────────────────
    graph.add_node("node_ingestion", node_ingestion)
    graph.add_node("node_rag_retrieval", node_rag_retrieval)
    graph.add_node("node_plan_generation", node_plan_generation)
    graph.add_node("node_security_guard", node_security_guard)
    graph.add_node("node_hr_guard", node_hr_guard)
    graph.add_node("node_policy_guard", node_policy_guard)
    graph.add_node("node_sla_guard", node_sla_guard)
    graph.add_node("node_fan_in_reducer", node_fan_in_reducer)
    graph.add_node("node_meta_governance", node_meta_governance)
    graph.add_node("node_execution", node_execution)
    graph.add_node("node_retry", node_retry)
    graph.add_node("node_hitl_escalation", node_hitl_escalation)
    graph.add_node("node_feedback_loop", node_feedback_loop)

    # ── START → node_ingestion ─────────────────────────────────────────
    graph.add_edge(START, "node_ingestion")

    # ── node_ingestion → confidence_router (conditional) ───────────────
    graph.add_conditional_edges(
        "node_ingestion",
        confidence_router,
        {
            "END": END,
            "node_hitl_escalation": "node_hitl_escalation",
            "node_rag_retrieval": "node_rag_retrieval",
        },
    )

    # ── node_rag_retrieval → node_plan_generation ──────────────────────
    graph.add_edge("node_rag_retrieval", "node_plan_generation")

    # ── node_plan_generation → fan-out to 4 guard nodes ────────────────
    graph.add_edge("node_plan_generation", "node_security_guard")
    graph.add_edge("node_plan_generation", "node_hr_guard")
    graph.add_edge("node_plan_generation", "node_policy_guard")
    graph.add_edge("node_plan_generation", "node_sla_guard")

    # ── All 4 guards → node_fan_in_reducer (fan-in) ────────────────────
    graph.add_edge("node_security_guard", "node_fan_in_reducer")
    graph.add_edge("node_hr_guard", "node_fan_in_reducer")
    graph.add_edge("node_policy_guard", "node_fan_in_reducer")
    graph.add_edge("node_sla_guard", "node_fan_in_reducer")

    # ── node_fan_in_reducer → node_meta_governance ─────────────────────
    graph.add_edge("node_fan_in_reducer", "node_meta_governance")

    # ── node_meta_governance → plan_router (conditional) ───────────────
    graph.add_conditional_edges(
        "node_meta_governance",
        plan_router,
        {
            "advance": "node_execution",
            "loop": "node_plan_generation",
            "escalate": "node_hitl_escalation",
        },
    )

    # ── node_execution → execution_router (conditional) ────────────────
    graph.add_conditional_edges(
        "node_execution",
        execution_router,
        {
            "feedback": "node_feedback_loop",
            "retry": "node_retry",
            "hitl": "node_hitl_escalation",
        },
    )

    # ── node_retry → node_execution ────────────────────────────────────
    graph.add_edge("node_retry", "node_execution")

    # ── Terminal nodes → END ───────────────────────────────────────────
    graph.add_edge("node_hitl_escalation", END)
    graph.add_edge("node_feedback_loop", END)

    return graph


# Compile the graph once at module level for reuse
compiled_graph = build_graph().compile()
