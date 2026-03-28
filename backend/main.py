"""
AutoOps Orchestrator — FastAPI Application
============================================
Entry-point for the AutoOps backend.

Contains:
  • FastAPI app with metadata
  • RBAC middleware stub (reads ``X-Role`` header)
  • DEMO_MODE router (loads fixtures from ``demo_fixtures/``)
  • MCP server mounting (official ``mcp`` SDK via Starlette Mount)
  • ``POST /webhook/ingest`` — async graph invocation via background task
  • ``GET /run/{run_id}/state`` — retrieve run state
  • ``GET /run/{run_id}/audit`` — retrieve audit trail
  • ``POST /run/{run_id}/hitl/approve`` — approve HITL (RBAC-gated)
  • ``POST /run/{run_id}/hitl/resimulate`` — resimulate (RBAC-gated)
  • ``GET /metrics/summary`` — aggregate metrics
  • ``GET /health`` — basic health check
  • Uvicorn run block
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import uuid
from datetime import datetime, timezone
import httpx
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response, APIRouter
from fastapi.responses import JSONResponse
from starlette.routing import Mount

from state_schema import AutoOpsState
from graph import compiled_graph
from mcp_server import mcp_server

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

load_dotenv()

DEMO_MODE: bool = os.getenv("DEMO_MODE", "FALSE").upper() == "TRUE"
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

logger = logging.getLogger("autoops")
logging.basicConfig(level=logging.INFO)

# ---------------------------------------------------------------------------
# In-memory run store (maps run_id → final graph state)
# ---------------------------------------------------------------------------

_run_store: Dict[str, Dict[str, Any]] = {}

# ---------------------------------------------------------------------------
# Fixture loader utility
# ---------------------------------------------------------------------------

FIXTURES_DIR = Path(__file__).parent / "demo_fixtures"


def _load_fixture(filename: str) -> Dict[str, Any]:
    """Load a JSON fixture file from the ``demo_fixtures/`` directory."""
    filepath = FIXTURES_DIR / filename
    with open(filepath, "r", encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="AutoOps Orchestrator",
    description=(
        "Multi-agent enterprise workflow automation system.  "
        "Orchestrates onboarding, meeting-transcript processing, "
        "and SLA-check workflows via a LangGraph state machine backed "
        "by guard agents, meta-governance, and human-in-the-loop escalation."
    ),
    version="0.1.0",
)


# ---------------------------------------------------------------------------
# RBAC Middleware Stub
# ---------------------------------------------------------------------------

@app.middleware("http")
async def rbac_middleware(request: Request, call_next) -> Response:
    """Stub RBAC middleware — reads ``X-Role`` header and attaches it to
    ``request.state.role``.

    No real authentication is performed; this is a placeholder for the
    full RBAC implementation.
    """
    request.state.role = request.headers.get("X-Role", "anonymous")
    response = await call_next(request)
    return response


# ---------------------------------------------------------------------------
# RBAC Dependency for HITL endpoints
# ---------------------------------------------------------------------------

def require_rbac(request: Request) -> str:
    """FastAPI dependency that extracts the user role from
    ``request.state.role`` (set by the RBAC middleware).

    Raises 403 if the role is ``anonymous`` or missing.
    """
    role: str = getattr(request.state, "role", "anonymous")
    if role == "anonymous":
        raise HTTPException(status_code=403, detail="RBAC: insufficient privileges")
    return role


# ---------------------------------------------------------------------------
# DEMO_MODE Router
# ---------------------------------------------------------------------------

demo_router = APIRouter(prefix="/demo", tags=["demo"])


@demo_router.get("/jira")
async def demo_jira() -> Dict[str, Any]:
    """Return pre-computed JIRA fixture response."""
    fixtures = _load_fixture("demo_mock_responses.json")
    return fixtures["jira"]


@demo_router.get("/slack")
async def demo_slack() -> Dict[str, Any]:
    """Return pre-computed Slack fixture response."""
    fixtures = _load_fixture("demo_mock_responses.json")
    return fixtures["slack"]


@demo_router.get("/ad")
async def demo_ad() -> Dict[str, Any]:
    """Return pre-computed Active Directory fixture response."""
    fixtures = _load_fixture("demo_mock_responses.json")
    return fixtures["ad"]


@demo_router.get("/github")
async def demo_github() -> Dict[str, Any]:
    """Return pre-computed GitHub fixture response."""
    fixtures = _load_fixture("demo_mock_responses.json")
    return fixtures["github"]


@demo_router.get("/fixture/{node_name}")
async def demo_node_fixture(node_name: str) -> Dict[str, Any]:
    """Return the pre-computed fixture for any graph node.

    Parameters
    ----------
    node_name : str
        The node name without prefix, e.g. ``ingestion`` resolves to
        ``node_ingestion_response.json``.
    """
    filename = f"node_{node_name}_response.json"
    try:
        return _load_fixture(filename)
    except FileNotFoundError:
        return {"error": f"Fixture not found: {filename}"}


if DEMO_MODE:
    app.include_router(demo_router)
    logger.info("DEMO_MODE is ON — mock fixture endpoints mounted at /demo/*")
else:
    logger.info("DEMO_MODE is OFF — running in production mode")


# ---------------------------------------------------------------------------
# Mount MCP Server
# ---------------------------------------------------------------------------

# The official MCP SDK exposes a Starlette-compatible ASGI app via
# ``mcp_server.streamable_http_app()``.  We mount it into the FastAPI
# app using Starlette's Mount so clients can reach it at ``/mcp``.

@contextlib.asynccontextmanager
async def _lifespan(app_instance: FastAPI):
    """Manage the MCP session-manager lifecycle."""
    async with mcp_server.session_manager.run():
        yield

# Attach the lifespan to the FastAPI app
app.router.lifespan_context = _lifespan

# Mount the MCP streamable-HTTP ASGI app at /mcp
mcp_server.settings.streamable_http_path = "/"
app.router.routes.append(
    Mount("/mcp", app=mcp_server.streamable_http_app())
)


# ---------------------------------------------------------------------------
# Background graph invocation helper
# ---------------------------------------------------------------------------

async def _broadcast_supabase_realtime(payload: dict):
    """Fire-and-forget REST call to Supabase Realtime broadcast."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return
    url = f"{SUPABASE_URL}/realtime/v1/api/broadcast"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json"
    }
    
    # Supabase expects the payload wrapped in a 'messages' array
    data = {
        "messages": [
            {
                "topic": "autoops_node_states", 
                "event": "node_transition",
                "payload": payload
            }
        ]
    }
    
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(url, headers=headers, json=data)
            if resp.status_code not in [200, 201, 202]:
                logger.warning(f"Supabase broadcast error: {resp.text}")
        except Exception as e:
            logger.warning(f"Supabase broadcast failed: {e}")

async def _run_graph_in_background(run_id: str, initial_state: AutoOpsState) -> None:
    try:
        loop = asyncio.get_running_loop()
        current_state = initial_state
        
        # Use a synchronous generator in an executor to avoid blocking the event loop
        def run_stream():
            return list(compiled_graph.stream(initial_state))
            
        steps = await loop.run_in_executor(None, run_stream)
        
        for step in steps:
            node_id = list(step.keys())[0]
            state_snapshot = step[node_id]
            for k, v in state_snapshot.items():
                current_state[k] = v
            
            # 1. Update local store
            _run_store[run_id] = {"status": "active", "final_state": current_state}
            
            # 2. Broadcast to M3's UI
            await _broadcast_supabase_realtime({
                "run_id": run_id,
                "node_id": node_id,
                "status": "waiting_hitl" if current_state.get("hitl_status") == "pending" and node_id == "node_hitl_escalation" else "active",
                "state_snapshot": current_state,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # 3. Trigger 4-Hour TTL if HITL is pending
            if node_id == "node_hitl_escalation" and current_state.get("hitl_status") == "pending":
                asyncio.create_task(_hitl_ttl_timer(run_id))
                
        _run_store[run_id]["status"] = "completed"
        await _broadcast_supabase_realtime({"run_id": run_id, "node_id": "END", "status": "completed", "state_snapshot": current_state, "timestamp": datetime.now(timezone.utc).isoformat()})
        logger.info("Graph run %s completed", run_id)
        
    except Exception as exc:
        logger.exception("Graph run %s failed", run_id)
        _run_store[run_id] = {"status": "error", "detail": str(exc)}
        await _broadcast_supabase_realtime({"run_id": run_id, "node_id": "ERROR", "status": "failed", "state_snapshot": {}, "timestamp": datetime.now(timezone.utc).isoformat()})


# ---------------------------------------------------------------------------
# Core Endpoints
# ---------------------------------------------------------------------------

@app.get("/health", tags=["system"])
async def health_check() -> Dict[str, str]:
    """Basic liveness probe."""
    return {"status": "ok"}


@app.post("/webhook/ingest", tags=["workflow"])
async def webhook_ingest(request: Request) -> JSONResponse:
    """Accept a JSON payload, extract the webhook signature from
    request headers, inject it into the body, and invoke the graph
    asynchronously in the background.

    Returns ``{"run_id": ..., "status": "started"}`` immediately.
    """
    # 1. Capture the RAW, untouched bytes for the HMAC check
    raw_body_bytes = await request.body()
    
    # 2. Parse the JSON for normal use
    body: Dict[str, Any] = await request.json()

    # Generate a unique run_id
    run_id = str(uuid.uuid4())

    # Extract the webhook signature from the actual HTTP headers and
    # inject it into body["headers"] so graph nodes can read it
    sig = request.headers.get("x-webhook-signature", "")
    if "headers" not in body:
        body["headers"] = {}
    body["headers"]["x-webhook-signature"] = sig

    # Construct the initial state with required defaults
    initial_state: AutoOpsState = {
        "payload_type": body.get("payload_type", "onboarding"),
        "raw_payload": body.get("raw_payload", body),
        
        "raw_body_bytes_hex": raw_body_bytes.hex(), 
        
        "hire_profile": {},
        "payload_confidence": 0.0,
        "integrity_check_passed": False,
        "historical_context": "NULL_CONTEXT",
        "similarity_gate_passed": False,
        "proposed_plan": {},
        "reflection_passed": False,
        "pydantic_retry_count": 0,
        "security_feedback": {},
        "hr_feedback": {},
        "policy_feedback": {},
        "sla_feedback": {},
        "audit_feedback": [],
        "meta_governance_decision": {},
        "condenser_summary": "",
        "iteration_count": 0,
        "execution_log": [],
        "hitl_status": "approved",
        "hitl_approvers": [],
        "zero_shot_success": False,
        "execution_receipt": {},
    }

    # Mark the run as started
    _run_store[run_id] = {"status": "started"}

    # Fire-and-forget the graph invocation
    asyncio.create_task(_run_graph_in_background(run_id, initial_state))

    return JSONResponse(
        content={"run_id": run_id, "status": "started"},
        status_code=202,
    )


# ---------------------------------------------------------------------------
# Run State & Audit Endpoints
# ---------------------------------------------------------------------------

@app.get("/run/{run_id}/state", tags=["workflow"])
async def get_run_state(run_id: str) -> JSONResponse:
    """Return the current state of a graph run."""
    entry = _run_store.get(run_id)
    if entry is None:
        return JSONResponse(content={"error": "run_id not found"}, status_code=404)
    return JSONResponse(content=entry, status_code=200)


@app.get("/run/{run_id}/audit", tags=["workflow"])
async def get_run_audit(run_id: str) -> JSONResponse:
    """Return the audit trail for a graph run."""
    entry = _run_store.get(run_id)
    if entry is None:
        return JSONResponse(content={"error": "run_id not found"}, status_code=404)

    final_state = entry.get("final_state", {})
    audit = {
        "run_id": run_id,
        "status": entry.get("status", "unknown"),
        "audit_feedback": final_state.get("audit_feedback", []),
        "meta_governance_decision": final_state.get("meta_governance_decision", {}),
        "execution_log": final_state.get("execution_log", []),
        "hitl_status": final_state.get("hitl_status", "pending"),
        "iteration_count": final_state.get("iteration_count", 0),
    }
    return JSONResponse(content=audit, status_code=200)


# ---------------------------------------------------------------------------
# HITL Endpoints (RBAC-gated)
# ---------------------------------------------------------------------------

@app.post("/run/{run_id}/hitl/approve", tags=["hitl"])
async def hitl_approve(run_id: str, role: str = Depends(require_rbac)) -> JSONResponse:
    """Approve a HITL escalation. Requires a valid RBAC role."""
    entry = _run_store.get(run_id)
    if entry is None:
        return JSONResponse(content={"error": "run_id not found"}, status_code=404)

    final_state = entry.get("final_state", {})
    final_state["hitl_status"] = "approved"
    approvers = list(final_state.get("hitl_approvers", []))
    approvers.append(role)
    final_state["hitl_approvers"] = approvers
    entry["final_state"] = final_state

    return JSONResponse(
        content={"run_id": run_id, "hitl_status": "approved", "approved_by": role},
        status_code=200,
    )


@app.post("/run/{run_id}/hitl/resimulate", tags=["hitl"])
async def hitl_resimulate(run_id: str, role: str = Depends(require_rbac)) -> JSONResponse:
    """Trigger a resimulation of the graph run. Requires a valid RBAC role."""
    entry = _run_store.get(run_id)
    if entry is None:
        return JSONResponse(content={"error": "run_id not found"}, status_code=404)

    final_state = entry.get("final_state", {})
    final_state["hitl_status"] = "pending"

    return JSONResponse(
        content={"run_id": run_id, "status": "resimulation_started", "triggered_by": role},
        status_code=200,
    )


# ---------------------------------------------------------------------------
# Metrics Endpoint
# ---------------------------------------------------------------------------

@app.get("/metrics/summary", tags=["metrics"])
async def metrics_summary() -> JSONResponse:
    """Return mock aggregate metrics."""
    total_runs = len(_run_store)
    completed = sum(1 for v in _run_store.values() if v.get("status") == "completed")
    errored = sum(1 for v in _run_store.values() if v.get("status") == "error")
    in_progress = sum(1 for v in _run_store.values() if v.get("status") == "started")

    return JSONResponse(
        content={
            "total_runs": total_runs,
            "completed": completed,
            "errored": errored,
            "in_progress": in_progress,
            "hitl_pending": sum(
                1 for v in _run_store.values()
                if v.get("final_state", {}).get("hitl_status") == "pending"
            ),
        },
        status_code=200,
    )

async def _hitl_ttl_timer(run_id: str):
    """Waits 4 hours. If HITL is still pending, marks it as timed_out."""
    # 4 hours = 14400 seconds. Using 10 seconds for DEMO_MODE testing.
    sleep_time = 10 if DEMO_MODE else 14400 
    await asyncio.sleep(sleep_time)
    
    entry = _run_store.get(run_id)
    if entry and entry.get("final_state", {}).get("hitl_status") == "pending":
        entry["final_state"]["hitl_status"] = "timed_out"
        logger.warning(f"Run {run_id} HITL timed out after {sleep_time}s")
        await _broadcast_supabase_realtime({
            "run_id": run_id,
            "node_id": "TTL_MONITOR",
            "status": "failed",
            "state_snapshot": entry["final_state"],
            "timestamp": datetime.now(timezone.utc).isoformat()
        })

# ---------------------------------------------------------------------------
# Uvicorn entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
