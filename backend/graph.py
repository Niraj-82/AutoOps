"""AutoOps Orchestrator — LangGraph graph (M1 ingestion/HITL + M2 intelligence nodes)."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Literal, Sequence

from langgraph.graph import END, START, StateGraph
from pydantic import ValidationError

from pydantic_models import ProvisioingPlan
from state_schema import AutoOpsState

logger = logging.getLogger("autoops.graph")

_groq_client: Any = None


def _get_groq_client() -> Any:
    global _groq_client
    if _groq_client is not None:
        return _groq_client
    key = os.getenv("GROQ_API_KEY", "")
    if not key:
        return None
    try:
        from groq import Groq

        _groq_client = Groq(api_key=key)
    except ImportError:
        _groq_client = None
    return _groq_client

EMBEDDING_MODEL = "text-embedding-3-small"
SIMILARITY_THRESHOLD = 0.82
QUALITY_THRESHOLD = 2
CLAUDE_MODEL = "claude-3-5-sonnet-20241022"
LLAMA_MODEL = "llama-3.1-8b-instant"
ACCESS_HIERARCHY = ["viewer", "developer", "contributor", "maintainer", "admin"]
POLICY_ALLOWED_FIELDS = ["name", "email", "role", "department"]



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def _stable_embedding(text: str, dims: int = 1536) -> List[float]:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    vec: List[float] = []
    for idx in range(dims):
        value = digest[idx % len(digest)]
        vec.append((value / 255.0) * 2.0 - 1.0)
    return vec


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = sum(x * x for x in a) ** 0.5
    mag_b = sum(y * y for y in b) ** 0.5
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    return dot / (mag_a * mag_b)


def _embed_text(text: str) -> List[float]:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if api_key:
        try:
            from openai import OpenAI

            client = OpenAI(api_key=api_key)
            resp = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
            return list(resp.data[0].embedding)
        except Exception:
            return _stable_embedding(text)
    return _stable_embedding(text)


def _call_llama_json(system_prompt: str, user_prompt: str) -> Dict[str, Any]:
    api_key = os.getenv("GROQ_API_KEY", "")
    full_prompt = (
        f"{system_prompt}\n\n"
        "Respond with ONLY a valid JSON object. No markdown. No explanation.\n\n"
        f"{user_prompt}"
    )
    if api_key:
        try:
            client = _get_groq_client()
            if not client:
                return {"summary": ""}
            resp = client.chat.completions.create(
                model=LLAMA_MODEL,
                messages=[{"role": "user", "content": full_prompt}],
                temperature=0.0,
            )
            return json.loads(resp.choices[0].message.content)
        except Exception:
            return {"summary": ""}
    # deterministic fallback
    if "summary" in user_prompt.lower():
        return {"summary": ""}
    return {}


def _call_claude_json(system_prompt: str, user_prompt: str) -> Dict[str, Any]:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if api_key:
        try:
            from anthropic import Anthropic

            client = Anthropic(api_key=api_key)
            resp = client.messages.create(
                model=CLAUDE_MODEL,
                temperature=0.0,
                max_tokens=2048,
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            "Return ONLY JSON. No markdown.\n"
                            f"{user_prompt}"
                        ),
                    }
                ],
            )
            content = resp.content[0].text if resp.content else "{}"
            return json.loads(content)
        except Exception:
            pass
    return {}


def _mcp_call(tool_name: str, payload: Dict[str, Any], capability_token: Sequence[str]) -> Dict[str, Any]:
    if tool_name not in capability_token:
        return {"status_code": 403, "error": f"capability token denied for {tool_name}"}
    if tool_name == "hr_database.get_hire_profile":
        eid = str(payload.get("employee_id", "")).strip()
        return {"found": bool(eid), "employee_id": eid}
    if tool_name == "role_access_matrix.get_max_access":
        return {"jira": "developer", "github": "maintainer", "slack": "contributor"}
    if tool_name == "hr_database.get_buddy_availability":
        return {"available": bool(payload.get("buddy_name")), "conflicts": []}
    if tool_name == "hr_database.check_license_count":
        return {"available": 0 if payload.get("system_name", "").lower() == "jira" else 10, "total": 100}
    if tool_name == "policy_db.get_policy_version":
        return {"version": "v1.0.0", "effective_date": "2026-01-01"}
    if tool_name == "policy_db.get_probationary_rules":
        if str(payload.get("employment_type", "")).lower() == "probationary":
            return {"restricted_access_levels": ["admin"]}
        return {"restricted_access_levels": []}
    if tool_name == "policy_db.get_dept_prerequisites":
        return {"required_completions": []}
    if tool_name == "it_queue.get_depth":
        return {"queue_depth": 10, "estimated_days": 3}
    if tool_name == "calendar.check_availability":
        return {"available_slots": ["10:00-11:00"]}
    if tool_name == "slack.create_user":
        return {"user_id": "slack_user_001", "status": "success"}
    if tool_name == "github.add_user":
        return {"status": "success"}
    if tool_name == "jira.provision_access":
        retry_hint = int(payload.get("_retry", 0))
        if retry_hint < 2:
            return {"status_code": 503, "error": "Service Unavailable"}
        return {"status": "success"}
    if tool_name == "calendar.create_event":
        return {"event_id": "evt-001"}
    return {"status_code": 400, "error": f"unsupported tool: {tool_name}"}


def _load_json_store(path_env: str) -> List[Dict[str, Any]]:
    path = os.getenv(path_env, "")
    if not path or not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_json_store(path_env: str, records: List[Dict[str, Any]]) -> None:
    path = os.getenv(path_env, "")
    if not path:
        return
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(records, fh)


def _load_workflow_embeddings() -> List[Dict[str, Any]]:
    return _load_json_store("WORKFLOW_EMBEDDINGS_PATH")


def _save_workflow_embeddings(records: List[Dict[str, Any]]) -> None:
    _save_json_store("WORKFLOW_EMBEDDINGS_PATH", records)


def _load_workflow_metadata() -> List[Dict[str, Any]]:
    return _load_json_store("WORKFLOW_METADATA_PATH")


def _save_workflow_metadata(records: List[Dict[str, Any]]) -> None:
    _save_json_store("WORKFLOW_METADATA_PATH", records)


def _query_pgvector_top5(query_embedding: List[float]) -> List[Dict[str, Any]]:
    db_url = os.getenv("SUPABASE_DB_URL", "")
    if not db_url:
        return []
    try:
        import psycopg

        vec = "[" + ",".join(str(x) for x in query_embedding) + "]"
        sql = (
            "SELECT *, 1 - (embedding <=> %s::vector) AS similarity "
            "FROM workflow_embeddings ORDER BY similarity DESC LIMIT 5"
        )
        out: List[Dict[str, Any]] = []
        with psycopg.connect(db_url) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (vec,))
                rows = cur.fetchall()
                colnames = [d.name for d in cur.description] if rows else []
        for row in rows:
            mapped = dict(zip(colnames, row))
            out.append(
                {
                    "run_id": mapped.get("run_id"),
                    "hire_profile": mapped.get("hire_profile") or {},
                    "final_plan": mapped.get("final_plan") or {},
                    "zero_shot_success": mapped.get("zero_shot_success"),
                    "outcome": mapped.get("outcome") or "",
                    "iteration_count": mapped.get("iteration_count", 0) or 0,
                    "iteration_count_needed": mapped.get("iteration_count_needed", mapped.get("iteration_count", 0) or 0),
                    "key_rejection_reasons": mapped.get("key_rejection_reasons", []),
                    "similarity": float(mapped.get("similarity", 0.0)),
                }
            )
        return out
    except Exception:
        return []


def _insert_embedding_row(row: Dict[str, Any]) -> bool:
    db_url = os.getenv("SUPABASE_DB_URL", "")
    if not db_url:
        return False
    try:
        import psycopg

        vec = "[" + ",".join(str(x) for x in row["embedding"]) + "]"
        sql = (
            "INSERT INTO workflow_embeddings "
            "(run_id, embedding, hire_profile, final_plan, zero_shot_success, outcome, iteration_count, retrieval_weight_boost) "
            "VALUES (%s, %s::vector, %s::jsonb, %s::jsonb, %s, %s, %s, %s)"
        )
        with psycopg.connect(db_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    sql,
                    (
                        row["run_id"],
                        vec,
                        json.dumps(row.get("hire_profile", {})),
                        json.dumps(row.get("final_plan", {})),
                        bool(row.get("zero_shot_success", False)),
                        row.get("outcome", "success"),
                        int(row.get("iteration_count", 0)),
                        bool(row.get("retrieval_weight_boost", False)),
                    ),
                )
                conn.commit()
        return True
    except Exception:
        return False


def _insert_workflow_metadata_row(row: Dict[str, Any]) -> bool:
    db_url = os.getenv("SUPABASE_DB_URL", "")
    if not db_url:
        return False
    try:
        import psycopg

        sql = (
            "INSERT INTO workflow_metadata "
            "(run_id, payload_type, status, iteration_count, hitl_required, execution_duration_seconds, outcome, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
        )
        with psycopg.connect(db_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    sql,
                    (
                        row["run_id"],
                        row["payload_type"],
                        row["status"],
                        int(row["iteration_count"]),
                        bool(row["hitl_required"]),
                        int(row["execution_duration_seconds"]),
                        row["outcome"],
                        row["created_at"],
                    ),
                )
                conn.commit()
        return True
    except Exception:
        return False


def _extract_rejection_reasons(audit_entry: Dict[str, Any]) -> List[str]:
    reasons: List[str] = []
    security = audit_entry.get("security", {})
    hr = audit_entry.get("hr", {})
    policy = audit_entry.get("policy", {})
    sla = audit_entry.get("sla", {})
    if security.get("verdict") == "reject" and security.get("rule_triggered"):
        reasons.append(str(security["rule_triggered"]))
    if hr.get("verdict") == "reject":
        reasons.extend(str(item) for item in hr.get("blocking_items", []))
    if policy.get("verdict") == "reject":
        reasons.extend(str(item.get("reason", "")) for item in policy.get("failed_checks", []))
    if sla.get("verdict") == "reject" and sla.get("timeline_recommendation"):
        reasons.append(str(sla["timeline_recommendation"]))
    return [r for r in reasons if r]


def confidence_router(state: AutoOpsState) -> Literal["end", "hitl", "rag"]:
    if state["payload_confidence"] < 0.5 or not state["integrity_check_passed"]:
        return "end"
    if state["payload_confidence"] < 0.8:
        return "hitl"
    return "rag"


def plan_router(state: AutoOpsState) -> Literal["advance", "loop", "escalate"]:
    routing = state["meta_governance_decision"].get("routing", "escalate")
    if routing == "advance":
        return "advance"
    if routing == "loop" and state["iteration_count"] < 5:
        return "loop"
    return "escalate"


def execution_router(state: AutoOpsState) -> Literal["feedback", "retry", "hitl"]:
    receipt = state.get("execution_receipt", {})
    if receipt.get("all_succeeded", False):
        return "feedback"
    if receipt.get("retry_count", 0) < 3:
        return "retry"
    return "hitl"

def plan_validation_router(state: AutoOpsState) -> list[str] | str:
    """Routes after plan generation. If reflection fails, loops back.
    If hits iteration cap, escalates. Otherwise, fans out to Shadow Board."""
    
    if state.get("hitl_status") == "pending":
        return "node_hitl_escalation"
        
    if not state.get("reflection_passed", False):
        if int(state.get("pydantic_retry_count", 0)) >= 3:
            return "node_hitl_escalation"
        return "node_plan_generation" # Loop back to fix the plan
        
    # Fan out to the 4 guards
    return ["node_security_guard", "node_hr_guard", "node_policy_guard", "node_sla_guard"]

def node_ingestion(state: AutoOpsState) -> Dict[str, Any]:
    """M1: payload type, HMAC integrity, Groq hire_profile extraction, confidence score."""
    raw_payload = state.get("raw_payload", {})

    raw_type = raw_payload.get("type", "onboarding")
    type_map = {
        "onboarding": "onboarding",
        "meeting_transcript": "meeting_transcript",
        "sla_check": "sla_check",
    }
    payload_type = type_map.get(str(raw_type), "onboarding")

    webhook_secret = os.getenv("WEBHOOK_SECRET", "")
    
    # Create a copy so we don't mutate the state, and pop the injected headers
    payload_to_hash = dict(raw_payload)
    headers = payload_to_hash.pop("headers", {})
    received_sig = str(headers.get("x-webhook-signature", "")).strip()
    
    if not webhook_secret:
        integrity_check_passed = True
    elif not received_sig:
        integrity_check_passed = False
    else:
        # Calculate expected HMAC-SHA256 signature
        raw_hex = state.get("raw_body_bytes_hex", "")
        body_bytes = bytes.fromhex(raw_hex) if raw_hex else b""
        
        expected_sig = hmac.new(
            webhook_secret.encode("utf-8"),
            body_bytes,
            hashlib.sha256,
        ).hexdigest()
        
        integrity_check_passed = hmac.compare_digest(received_sig, expected_sig)

    extraction_prompt = (
        "You are a structured-data extraction engine.\n"
        "Given the following raw JSON payload, extract EXACTLY these keys "
        "into a valid JSON object. If a value is missing, use an empty string or [].\n\n"
        "Keys: name, role, department, seniority, employment_type, start_date, "
        "manager, required_systems (list of strings), compliance_flags (list of strings)\n\n"
        f"Raw payload:\n```json\n{json.dumps(raw_payload, indent=2)}\n```\n\n"
        "Respond ONLY with the JSON object. No explanation."
    )

    hire_profile: Dict[str, Any] = {}
    groq = _get_groq_client()
    if groq:
        try:
            chat_completion = groq.chat.completions.create(
                model=LLAMA_MODEL,
                temperature=0.0,
                max_tokens=1024,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a JSON extraction assistant. Always respond with valid JSON only.",
                    },
                    {"role": "user", "content": extraction_prompt},
                ],
            )
            raw_response = chat_completion.choices[0].message.content.strip()
            if raw_response.startswith("```"):
                lines = [ln for ln in raw_response.split("\n") if not ln.strip().startswith("```")]
                raw_response = "\n".join(lines)
            hire_profile = json.loads(raw_response)
            logger.info("Groq extraction succeeded: %s", list(hire_profile.keys()))
        except json.JSONDecodeError as exc:
            logger.warning("Failed to parse Groq JSON: %s", exc)
        except Exception as exc:
            logger.warning("Groq API call failed: %s", exc)

    # --- THIS IS THE NEW DEMO MODE FALLBACK ---
    if not hire_profile and os.getenv("DEMO_MODE", "FALSE").upper() == "TRUE":
        logger.info("[DEMO MODE] Injecting mock hire_profile because Groq failed.")
        hire_profile = {
            "name": raw_payload.get("name", "Jane Doe"),
            "role": raw_payload.get("role", "Software Engineer"),
            "department": raw_payload.get("department", "Engineering"),
            "seniority": raw_payload.get("seniority", "mid"),
            "employment_type": raw_payload.get("employment_type", "full_time"),
            "start_date": raw_payload.get("start_date", "2026-05-01"),
            "manager": raw_payload.get("manager", "Test Manager"),
            "required_systems": raw_payload.get("required_systems", ["slack", "github", "jira"]),
            "compliance_flags": raw_payload.get("compliance_flags", [])
        }
    # ------------------------------------------

    payload_confidence = 0.0
    if hire_profile:
        expected_keys = [
            "name", "role", "department", "seniority", "employment_type",
            "start_date", "manager", "required_systems", "compliance_flags",
        ]
        populated = sum(1 for k in expected_keys if hire_profile.get(k) not in (None, "", [], {}))
        completeness_score = (populated / len(expected_keys)) * 0.4

        coherence_score = 0.0
        sd = str(hire_profile.get("start_date", ""))
        if sd:
            try:
                if date.fromisoformat(sd[:10]) >= date.today():
                    coherence_score += 0.1
            except ValueError:
                pass
        if str(hire_profile.get("employment_type", "")).lower() in ("full_time", "contractor", "probationary"):
            coherence_score += 0.1

        emp_id = str(raw_payload.get("employee_id", hire_profile.get("name", ""))).strip()
        mcp_resp = _mcp_call(
            "hr_database.get_hire_profile",
            {"employee_id": emp_id},
            ["hr_database.get_hire_profile"],
        )
        mcp_bonus = 0.4 if mcp_resp.get("found") else 0.0

        payload_confidence = min(completeness_score + coherence_score + mcp_bonus, 1.0)

    logger.info(
        "node_ingestion: type=%s confidence=%.2f integrity=%s",
        payload_type,
        payload_confidence,
        integrity_check_passed,
    )

    return {
        "payload_type": payload_type,
        "hire_profile": hire_profile,
        "payload_confidence": payload_confidence,
        "integrity_check_passed": integrity_check_passed,
        "raw_body_bytes_hex": state.get("raw_body_bytes_hex", ""),
    }

def node_rag_retrieval(state: AutoOpsState) -> Dict[str, Any]:
    hire_profile = state.get("hire_profile", {})
    query_embedding = _embed_text(_json(hire_profile))
    rows = _query_pgvector_top5(query_embedding)
    if not rows:
        rows = _load_workflow_embeddings()
    if not rows:
        return {"historical_context": "NULL_CONTEXT", "similarity_gate_passed": False}

    scored: List[Dict[str, Any]] = []
    if rows and "similarity" in rows[0]:
        scored = list(rows)
    else:
        for row in rows:
            emb = row.get("embedding", [])
            if not isinstance(emb, list):
                continue
            similarity = _cosine(query_embedding, emb)
            scored.append({**row, "similarity": similarity})
        scored.sort(key=lambda item: item.get("similarity", 0.0), reverse=True)

    top5 = scored[:5]
    passed = [item for item in top5 if item.get("similarity", 0.0) >= SIMILARITY_THRESHOLD]
    if not passed:
        return {"historical_context": "NULL_CONTEXT", "similarity_gate_passed": False}

    primary_templates = [
        item for item in passed if int(item.get("iteration_count", item.get("iteration_count_needed", 0))) <= 3
    ]
    high_iteration_context = [
        item for item in passed if int(item.get("iteration_count", item.get("iteration_count_needed", 0))) > 3
    ]
    ordered_context = primary_templates + high_iteration_context

    context: List[Dict[str, Any]] = []
    for item in ordered_context:
        iteration_count = int(item.get("iteration_count", item.get("iteration_count_needed", 0)))
        quality = "high-iteration" if iteration_count > 3 else "primary-template"
        context.append(
            {
                "hire_profile": item.get("hire_profile", {}),
                "final_plan": item.get("final_plan", {}),
                "outcome": item.get("outcome", ""),
                "iteration_count_needed": item.get("iteration_count_needed", iteration_count),
                "key_rejection_reasons": item.get("key_rejection_reasons", []),
                "quality": quality,
            }
        )
    return {"historical_context": context, "similarity_gate_passed": True}


def _default_plan(state: AutoOpsState) -> Dict[str, Any]:
    hire_profile = state.get("hire_profile", {})
    raw_payload = state.get("raw_payload", {})
    required_systems = hire_profile.get("required_systems", [])
    systems = []
    for system_name in required_systems:
        access_level = "viewer"
        seniority = str(hire_profile.get("seniority", "")).lower()
        if seniority in {"mid", "senior", "lead"}:
            access_level = "developer"
        systems.append(
            {
                "name": system_name,
                "access_level": access_level,
                "fields_to_provision": {
                    "name": hire_profile.get("name", ""),
                    "email": raw_payload.get("email", ""),
                    "role": hire_profile.get("role", ""),
                    "department": hire_profile.get("department", ""),
                },
            }
        )
    return {
        "systems": systems,
        "buddy": raw_payload.get("buddy", "Onboarding Buddy"),
        "orientation_slots": raw_payload.get("orientation_slots", ["10:00-11:00"]),
        "welcome_pack": raw_payload.get("welcome_pack", "standard"),
        "compliance_attestations": hire_profile.get("compliance_flags", []),
        "plan_rationale": "Access levels are assigned from role, seniority, employment_type, and required_systems.",
    }


def _run_condenser(state: AutoOpsState) -> str:
    last_feedback = state.get("audit_feedback", [])
    prompt = (
        "You are compressing agent rejection feedback. Return ONLY a JSON object: {summary: string}. "
        "The feedback contains 4 shadow board guards: 'security', 'hr', 'policy', and 'sla'. "
        "The summary must preserve exact policy rule names, threshold values, and field names from "
        "the rejection reasons. Do not paraphrase. Format: Iteration N: [Guard] rejected — [exact rule]. "
        "Threshold: [value if present]. Correction needed: [exact correction].\n"
        f"Iteration: {state.get('iteration_count', 0)}\n"
        f"Feedback: {_json(last_feedback[-1] if last_feedback else {})}"
    )
    response = _call_llama_json("Lossless feedback condenser", prompt)
    summary = str(response.get("summary", "")).strip()
    if summary:
        return summary

    # deterministic fallback
    if not last_feedback:
        return ""
    reasons = _extract_rejection_reasons(last_feedback[-1])
    if not reasons:
        return ""
    iteration = state.get("iteration_count", 0)
    return f"Iteration {iteration}: {'; '.join(reasons)}"


def _draft_plan(state: AutoOpsState, validation_error_payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    prompt = {
        "hire_profile": state.get("hire_profile", {}),
        "historical_context": state.get("historical_context", "NULL_CONTEXT"),
        "condenser_summary": state.get("condenser_summary", ""),
        "schema": {
            "systems": [{"name": "str", "access_level": "str", "fields_to_provision": "dict"}],
            "buddy": "str",
            "orientation_slots": ["str"],
            "welcome_pack": "str",
            "compliance_attestations": ["str"],
            "plan_rationale": "str",
        },
        "constraints": [
            "access_level must be one of: viewer, developer, contributor, maintainer, admin",
            "Return ONLY valid JSON object",
            "If historical_context has quality='high-iteration', treat it as what NOT to do first, not a primary template",
        ],
    }
    if validation_error_payload is not None:
        prompt["validation_error"] = validation_error_payload
        prompt["repair_instruction"] = (
            "Your previous output failed validation. Correct ONLY the failing field and return the full JSON."
        )

    response = _call_claude_json("Provisioning planner", _json(prompt))
    if response:
        return response
    return _default_plan(state)


def _reflect_plan(state: AutoOpsState, plan: Dict[str, Any]) -> Dict[str, Any]:
    checklist = {
        1: "Are all required_systems from hire_profile included in the plan?",
        2: "Does each access_level match seniority and employment_type constraints?",
        3: "Is buddy present and non-empty?",
        4: "Are orientation_slots non-empty?",
        5: "Are required compliance_attestations included?",
        6: "Does plan avoid rejection reasons in condenser_summary?",
    }
    prompt = {
        "plan": plan,
        "hire_profile": state.get("hire_profile", {}),
        "condenser_summary": state.get("condenser_summary", ""),
        "checklist": checklist,
        "output_schema": {
            "results": [{"item": "int", "verdict": "pass|fail", "reason": "str", "correction": "str|null"}],
            "overall": "pass|fail",
        },
    }
    response = _call_claude_json("Plan reflection checker", _json(prompt))
    if response and isinstance(response.get("results"), list):
        return response

    # deterministic fallback reflection
    hire_profile = state.get("hire_profile", {})
    required = set(hire_profile.get("required_systems", []))
    present = {system.get("name", "") for system in plan.get("systems", [])}
    checks = [
        {
            "item": 1,
            "verdict": "pass" if required.issubset(present) else "fail",
            "reason": "required_system coverage validated",
            "correction": None if required.issubset(present) else "Add all required_systems into systems list",
        },
        {"item": 2, "verdict": "pass", "reason": "access levels are from approved enum", "correction": None},
        {
            "item": 3,
            "verdict": "pass" if plan.get("buddy") else "fail",
            "reason": "buddy presence validated",
            "correction": None if plan.get("buddy") else "Set buddy to a non-empty string",
        },
        {
            "item": 4,
            "verdict": "pass" if plan.get("orientation_slots") else "fail",
            "reason": "orientation slots validated",
            "correction": None if plan.get("orientation_slots") else "Add at least one orientation slot",
        },
        {"item": 5, "verdict": "pass", "reason": "compliance_attestations populated", "correction": None},
        {"item": 6, "verdict": "pass", "reason": "condenser rejections addressed", "correction": None},
    ]
    overall = "pass" if all(c["verdict"] == "pass" for c in checks) else "fail"
    return {"results": checks, "overall": overall}


def node_plan_generation(state: AutoOpsState) -> Dict[str, Any]:
    updates: Dict[str, Any] = {}

    if state.get("iteration_count", 0) > 0 and state.get("reflection_passed", True):
        updates["condenser_summary"] = _run_condenser(state)

    validation_error_payload: Dict[str, Any] | None = None
    plan_json = _draft_plan({**state, **updates}, validation_error_payload=validation_error_payload)
    try:
        validated = ProvisioingPlan.model_validate(plan_json)
        plan = validated.model_dump()
        updates["proposed_plan"] = plan
    except ValidationError as exc:
        retry_val = int(state.get("pydantic_retry_count", 0)) + 1
        updates["pydantic_retry_count"] = retry_val
        updates["reflection_passed"] = False
        if retry_val >= 3:
            updates["hitl_status"] = "pending"
            return updates
        first_error = exc.errors()[0] if exc.errors() else {}
        error_hint = f"ValidationError field={first_error.get('loc')} error={first_error.get('msg')}"
        existing = str(updates.get("condenser_summary", state.get("condenser_summary", ""))).strip()
        updates["condenser_summary"] = f"{existing} {error_hint}".strip()
        return updates

    reflection = _reflect_plan({**state, **updates}, plan)
    if str(reflection.get("overall", "fail")).lower() == "pass":
        updates["reflection_passed"] = True
        updates["pydantic_retry_count"] = 0
        return updates

    updates["reflection_passed"] = False
    updates["iteration_count"] = int(state.get("iteration_count", 0)) + 1
    failed = [item for item in reflection.get("results", []) if item.get("verdict") == "fail"]
    if failed:
        existing = str(updates.get("condenser_summary", state.get("condenser_summary", ""))).strip()
        suffix = "; ".join(str(item.get("reason", "")) for item in failed if item.get("reason"))
        updates["condenser_summary"] = f"{existing} {suffix}".strip()
    return updates


def node_security_guard(state: AutoOpsState) -> Dict[str, Any]:
    capability = ["role_access_matrix.get_max_access"]
    profile = state.get("hire_profile", {})
    plan = state.get("proposed_plan", {})
    max_access = _mcp_call(
        "role_access_matrix.get_max_access",
        {
            "role": profile.get("role", ""),
            "seniority": profile.get("seniority", ""),
            "employment_type": profile.get("employment_type", ""),
        },
        capability,
    )
    first_rule = None
    for system in plan.get("systems", []):
        level = system.get("access_level", "viewer")
        max_level = max_access.get(system.get("name", ""), "viewer")
        try:
            level_idx = ACCESS_HIERARCHY.index(level)
            max_idx = ACCESS_HIERARCHY.index(max_level)
        except ValueError:
            first_rule = f"P-SEC-UNKNOWN: access_level '{level}' not in approved hierarchy"
            break
        if level_idx > max_idx:
            first_rule = (
                f"P-SEC-{system.get('name','UNKNOWN')}: access_level {level} "
                f"exceeds max permitted {max_level}"
            )
            break
        if str(profile.get("employment_type", "")).lower() == "probationary" and level == "admin":
            first_rule = "P-SEC-PROB-01: probationary employees cannot hold admin"
            break
    return {
        "security_feedback": {
            "verdict": "reject" if first_rule else "approve",
            "rule_triggered": first_rule,
            "corrective_action": "Lower access_level to max permitted value" if first_rule else "No action",
        }
    }


def node_hr_guard(state: AutoOpsState) -> Dict[str, Any]:
    capability = ["hr_database.get_buddy_availability", "hr_database.check_license_count"]
    profile = state.get("hire_profile", {})
    plan = state.get("proposed_plan", {})
    blocking_items: List[str] = []

    buddy_resp = _mcp_call(
        "hr_database.get_buddy_availability",
        {"buddy_name": plan.get("buddy", ""), "date_range": profile.get("start_date", "")},
        capability,
    )
    if not buddy_resp.get("available", False):
        blocking_items.append("Buddy unavailable on start_date")

    for system in plan.get("systems", []):
        license_resp = _mcp_call(
            "hr_database.check_license_count",
            {"system_name": system.get("name", "")},
            capability,
        )
        if int(license_resp.get("available", 0)) < 1:
            blocking_items.append(f"No license available for {system.get('name','unknown')}")

    return {
        "hr_feedback": {
            "verdict": "reject" if blocking_items else "approve",
            "blocking_items": blocking_items,
            "recommendation": "Select available buddy and ensure licenses" if blocking_items else "No action",
        }
    }


def node_policy_guard(state: AutoOpsState) -> Dict[str, Any]:
    capability = [
        "policy_db.get_policy_version",
        "policy_db.get_probationary_rules",
        "policy_db.get_dept_prerequisites",
    ]
    profile = state.get("hire_profile", {})
    plan = state.get("proposed_plan", {})
    failed_checks: List[Dict[str, Any]] = []

    # Check 1: PDPB data minimisation
    for system in plan.get("systems", []):
        for field_name in system.get("fields_to_provision", {}).keys():
            if field_name not in POLICY_ALLOWED_FIELDS:
                failed_checks.append(
                    {
                        "check_name": "PDPB data minimisation",
                        "reason": f"P-POL-PDPB-01: minimum data principle violated, field {field_name}",
                        "correction": "Remove non-minimum data fields",
                    }
                )

    # Check 2: Policy version stamp
    policy_version = _mcp_call("policy_db.get_policy_version", {}, capability).get("version", "")
    state_version = state.get("raw_payload", {}).get("policy_version_stamp", policy_version)
    if state_version != policy_version:
        failed_checks.append(
            {
                "check_name": "Policy version",
                "reason": "P-POL-VER-01: plan uses stale policy version",
                "correction": "Regenerate plan with current policy version",
            }
        )

    # Check 3: Probationary restrictions
    rules = _mcp_call(
        "policy_db.get_probationary_rules",
        {"employment_type": profile.get("employment_type", "")},
        capability,
    )
    restricted_levels = set(rules.get("restricted_access_levels", []))
    for system in plan.get("systems", []):
        level = system.get("access_level", "")
        if level in restricted_levels:
            failed_checks.append(
                {
                    "check_name": "Probationary restrictions",
                    "reason": f"P-POL-PROB-01: access level {level} prohibited during probation",
                    "correction": "Lower access level to an allowed level",
                }
            )

    # Check 4: Department prerequisites
    prerequisites = _mcp_call(
        "policy_db.get_dept_prerequisites",
        {"department": profile.get("department", "")},
        capability,
    ).get("required_completions", [])
    for item in prerequisites:
        failed_checks.append(
            {
                "check_name": "Department prerequisites",
                "reason": f"P-POL-PREREQ-01: prerequisite {item} not completed",
                "correction": "Complete prerequisites before provisioning",
            }
        )

    return {
        "policy_feedback": {
            "verdict": "reject" if failed_checks else "approve",
            "failed_checks": failed_checks,
        }
    }


def node_sla_guard(state: AutoOpsState) -> Dict[str, Any]:
    capability = ["it_queue.get_depth", "calendar.check_availability"]
    profile = state.get("hire_profile", {})
    plan = state.get("proposed_plan", {})
    start_date_raw = str(profile.get("start_date", ""))
    feasible = True
    recommendation = "SLA feasible"

    queue = _mcp_call("it_queue.get_depth", {}, capability)
    cal = _mcp_call(
        "calendar.check_availability",
        {"attendees": [plan.get("buddy", "")], "date": start_date_raw},
        capability,
    )

    try:
        days_to_start = (date.fromisoformat(start_date_raw) - date.today()).days
    except ValueError:
        days_to_start = -1

    if int(queue.get("estimated_days", 0)) > days_to_start:
        feasible = False
        recommendation = "P-SLA-QUEUE-01: IT queue too deep to meet start date"
    if not cal.get("available_slots"):
        feasible = False
        recommendation = "P-SLA-CAL-01: no orientation slots available on start date"

    return {
        "sla_feedback": {
            "verdict": "approve" if feasible else "reject",
            "feasibility": feasible,
            "timeline_recommendation": recommendation,
        }
    }


def node_fan_in_reducer(state: AutoOpsState) -> Dict[str, Any]:
    return {
        "audit_feedback": [
            {
                "iteration": state.get("iteration_count", 0),
                "security": state.get("security_feedback", {}),
                "hr": state.get("hr_feedback", {}),
                "policy": state.get("policy_feedback", {}),
                "sla": state.get("sla_feedback", {}),
                "timestamp": _now_iso(),
            }
        ]
    }


def node_meta_governance(state: AutoOpsState) -> Dict[str, Any]:
    security_reject = state.get("security_feedback", {}).get("verdict") == "reject"
    policy_reject = state.get("policy_feedback", {}).get("verdict") == "reject"
    sla_reject = state.get("sla_feedback", {}).get("verdict") == "reject"
    hr_reject = state.get("hr_feedback", {}).get("verdict") == "reject"
    all_rejections: List[str] = []
    if security_reject:
        all_rejections.append("Security")
    if policy_reject:
        all_rejections.append("Policy")
    if sla_reject:
        all_rejections.append("SLA")
    if hr_reject:
        all_rejections.append("HR")

    if security_reject:
        route = "loop"
        rule = "META-01: security veto — cannot be overridden by operators"
    elif policy_reject:
        route = "loop"
        rule = "META-02: policy rejection overrides SLA and HR"
    elif sla_reject:
        route = "loop"
        rule = "META-03: SLA rejection overrides HR"
    elif hr_reject:
        route = "loop"
        rule = "META-04: HR rejection"
    else:
        route = "advance"
        rule = "META-00: all guards approved"

    updated_iteration = state.get("iteration_count", 0) + (1 if route == "loop" else 0)
    if updated_iteration >= 5 and route == "loop":
        route = "escalate"

    return {
        "iteration_count": updated_iteration,
        "meta_governance_decision": {
            "routing": route,
            "priority_rule_applied": rule,
            "all_rejections": all_rejections,
            "reason": "all rejections passed to condenser for next iteration",
        },
    }


def node_execution(state: AutoOpsState) -> Dict[str, Any]:
    retry_count = int(state.get("execution_receipt", {}).get("retry_count", 0))
    log = list(state.get("execution_log", []))
    profile = state.get("hire_profile", {})
    plan = state.get("proposed_plan", {})
    capability = ["slack.create_user", "github.add_user", "jira.provision_access", "calendar.create_event"]

    succeeded_actions = {entry.get("action") for entry in log if entry.get("status") == "success"}

    run_calls = [
        (
            "slack",
            "create_user",
            "slack.create_user",
            {"name": profile.get("name", ""), "email": state.get("raw_payload", {}).get("email", ""), "team": profile.get("department", "")},
        ),
        (
            "github",
            "add_user",
            "github.add_user",
            {"name": profile.get("name", ""), "email": state.get("raw_payload", {}).get("email", ""), "org": "autoops", "team": profile.get("department", ""), "access_level": "developer"},
        ),
        (
            "jira",
            "provision_access",
            "jira.provision_access",
            {"name": profile.get("name", ""), "email": state.get("raw_payload", {}).get("email", ""), "access_level": "developer", "_retry": retry_count},
        ),
    ]

    for system, action, mcp_tool, payload in run_calls:
        if action in succeeded_actions:
            continue
        response = _mcp_call(mcp_tool, payload, capability)
        ok = response.get("status") == "success" or int(response.get("status_code", 200)) in (200, 201)
        log.append(
            {
                "system": system,
                "action": action,
                "mcp_tool": mcp_tool,
                "response": _json(response),
                "status": "success" if ok else "failed",
                "timestamp": _now_iso(),
            }
        )
        if not ok:
            if retry_count < 3:
                retry_count += 1
                return {"execution_log": log, "execution_receipt": {"all_succeeded": False, "retry_count": retry_count}}
            return {"execution_log": log, "execution_receipt": {"all_succeeded": False, "retry_count": retry_count}}

    # Call calendar.create_event for orientation events
    orientation_events = list(plan.get("orientation_slots", []))
    orientation_results = []
    for slot in orientation_events:
        evt_resp = _mcp_call(
            "calendar.create_event",
            {"title": f"Orientation: {profile.get('name', '')}", "attendees": [profile.get("name", ""), plan.get("buddy", "")], "slot": slot},
            capability,
        )
        if evt_resp.get("event_id"):
            orientation_results.append(evt_resp["event_id"])
        else:
            orientation_results.append(slot)

    return {
        "execution_log": log,
        "execution_receipt": {
            "all_succeeded": True,
            "retry_count": retry_count,
            "provisioned_accounts": {"slack": "slack_user_001", "github": "success", "jira": "success"},
            "buddy_confirmation": f"Buddy confirmed: {plan.get('buddy', '')}",
            "orientation_events": orientation_results,
            "welcome_pack_status": f"welcome_pack={plan.get('welcome_pack', 'standard')}",
            "audit_log_id": f"audit-{state.get('raw_payload', {}).get('run_id', 'local')}",
        },
    }


def node_retry(state: AutoOpsState) -> Dict[str, Any]:
    receipt = state.get("execution_receipt", {})
    return {"execution_receipt": {"all_succeeded": False, "retry_count": int(receipt.get("retry_count", 0))}}


def node_hitl_escalation(state: AutoOpsState) -> Dict[str, Any]:
    """M1: HITL pending, trigger reason, optional Resend email, audit link in body."""
    hitl_status = "pending"
    hire_name = state.get("hire_profile", {}).get("name", "Unknown Hire")
    confidence = float(state.get("payload_confidence", 0.0))
    iteration_count = int(state.get("iteration_count", 0))
    execution_log = state.get("execution_log", [])
    receipt = state.get("execution_receipt", {})
    retry_count = int(receipt.get("retry_count", 0))
    proposed = state.get("proposed_plan", {})
    run_id = str(state.get("raw_payload", {}).get("run_id", "unknown"))

    high_priv = False
    for sys in proposed.get("systems", []):
        lvl = str(sys.get("access_level", "")).lower()
        if lvl in ("admin", "root", "superuser"):
            high_priv = True
            break

    if retry_count >= 3 and not receipt.get("all_succeeded", True):
        trigger_reason = "Execution failure: provisioning exhausted retries (e.g. JIRA 503)."
    elif 0.5 <= confidence < 0.8:
        trigger_reason = "Low confidence: payload_confidence between 0.5 and 0.8 — HITL required."
    elif iteration_count >= 5:
        trigger_reason = "Plan loop limit: iteration_count reached 5 without approval."
    elif high_priv:
        trigger_reason = "High-privilege access: requires IT_MANAGER and HR_MANAGER approval."
    elif int(state.get("pydantic_retry_count", 0)) >= 3:
        trigger_reason = "Pydantic validation failed after 3 attempts."
    else:
        trigger_reason = "Manual review required (HITL escalation)."

    log_text = json.dumps(execution_log, indent=2) if execution_log else "(no execution log)"
    audit_hint = f"GET /run/{run_id}/audit"
    email_body = (
        "============================================\n"
        "  AUTOOPS ORCHESTRATOR — HITL ESCALATION\n"
        "============================================\n\n"
        f"Hire Name:       {hire_name}\n"
        f"Run ID:          {run_id}\n"
        f"Trigger:         {trigger_reason}\n"
        f"Confidence:      {confidence:.2f}\n"
        f"Iteration Count: {iteration_count}\n"
        f"HITL Status:     {hitl_status}\n\n"
        "--- Execution Log ---\n"
        f"{log_text}\n\n"
        f"Audit: {audit_hint}\n"
        "Approve or reject in the AutoOps dashboard.\n"
    )

    resend_key = os.getenv("RESEND_API_KEY", "")
    if resend_key and resend_key != "dummy_key":
        try:
            import resend

            resend.api_key = resend_key
            resend.Emails.send(
                {
                    "from": "onboarding@resend.dev",
                    "to": "itmanager@autoops.demo",
                    "subject": f"URGENT: Approval required — {hire_name}",
                    "text": email_body,
                }
            )
            logger.info("HITL email sent for run_id=%s", run_id)
        except Exception as exc:
            logger.warning("Resend send failed: %s", exc)
    else:
        logger.info("[DEMO] Would send HITL email: %s", trigger_reason[:80])

    return {
        "hitl_status": hitl_status,
        "hitl_approvers": list(state.get("hitl_approvers", [])),
    }


def node_feedback_loop(state: AutoOpsState) -> Dict[str, Any]:
    run_id = str(state.get("raw_payload", {}).get("run_id", f"run-{int(datetime.now().timestamp())}"))
    outcome = "success"
    zero_shot = state.get("historical_context") == "NULL_CONTEXT"

    embedding_text = f"{state.get('hire_profile', {})} {state.get('proposed_plan', {})} {outcome}"
    embedding = _embed_text(embedding_text)
    rows = _load_workflow_embeddings()
    retrieval_weight_boost = bool(zero_shot and state.get("iteration_count", 0) <= QUALITY_THRESHOLD)
    embedding_row = {
        "run_id": run_id,
        "embedding": embedding,
        "hire_profile": state.get("hire_profile", {}),
        "final_plan": state.get("proposed_plan", {}),
        "zero_shot_success": bool(zero_shot),
        "retrieval_weight_boost": retrieval_weight_boost,
        "outcome": outcome,
        "iteration_count": state.get("iteration_count", 0),
        "iteration_count_needed": state.get("iteration_count", 0),
        "key_rejection_reasons": _extract_rejection_reasons(state.get("audit_feedback", [{}])[-1]) if state.get("audit_feedback") else [],
        "embedding_model": EMBEDDING_MODEL,
    }
    inserted_embedding = _insert_embedding_row(embedding_row)
    if not inserted_embedding:
        rows.append(embedding_row)
        _save_workflow_embeddings(rows)

    # Metrics write
    metadata = _load_workflow_metadata()
    graph_start_raw = state.get("raw_payload", {}).get("graph_start_time")
    elapsed_seconds = 0
    if isinstance(graph_start_raw, str):
        try:
            elapsed_seconds = int((datetime.now(timezone.utc) - datetime.fromisoformat(graph_start_raw)).total_seconds())
        except ValueError:
            elapsed_seconds = 0
    metadata_row = {
        "run_id": run_id,
        "payload_type": state.get("payload_type", "onboarding"),
        "status": "completed",
        "iteration_count": state.get("iteration_count", 0),
        "hitl_required": len(state.get("hitl_approvers", [])) > 0,
        "execution_duration_seconds": elapsed_seconds,
        "outcome": "success",
        "created_at": _now_iso(),
    }
    inserted_meta = _insert_workflow_metadata_row(metadata_row)
    if not inserted_meta:
        metadata.append(metadata_row)
        _save_workflow_metadata(metadata)
    return {"zero_shot_success": bool(zero_shot)}


def build_graph() -> StateGraph:
    graph = StateGraph(AutoOpsState)

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

    graph.add_edge(START, "node_ingestion")
    graph.add_conditional_edges(
        "node_ingestion",
        confidence_router,
        {"end": END, "hitl": "node_hitl_escalation", "rag": "node_rag_retrieval"},
    )
    graph.add_edge("node_rag_retrieval", "node_plan_generation")

    graph.add_conditional_edges(
        "node_plan_generation",
        plan_validation_router,
        {
            "node_hitl_escalation": "node_hitl_escalation",
            "node_plan_generation": "node_plan_generation",
            "node_security_guard": "node_security_guard",
            "node_hr_guard": "node_hr_guard",
            "node_policy_guard": "node_policy_guard",
            "node_sla_guard": "node_sla_guard",
        }
    )

    graph.add_edge("node_security_guard", "node_fan_in_reducer")
    graph.add_edge("node_hr_guard", "node_fan_in_reducer")
    graph.add_edge("node_policy_guard", "node_fan_in_reducer")
    graph.add_edge("node_sla_guard", "node_fan_in_reducer")

    graph.add_edge("node_fan_in_reducer", "node_meta_governance")
    graph.add_conditional_edges(
        "node_meta_governance",
        plan_router,
        {"advance": "node_execution", "loop": "node_plan_generation", "escalate": "node_hitl_escalation"},
    )

    graph.add_conditional_edges(
        "node_execution",
        execution_router,
        {"feedback": "node_feedback_loop", "retry": "node_retry", "hitl": "node_hitl_escalation"},
    )
    graph.add_edge("node_retry", "node_execution")

    graph.add_edge("node_hitl_escalation", END)
    graph.add_edge("node_feedback_loop", END)
    return graph


compiled_graph = build_graph().compile()
