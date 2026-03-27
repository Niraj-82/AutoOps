"""
AutoOps Orchestrator — FastAPI Application
============================================
Entry-point for the AutoOps backend.

Contains:
  • FastAPI app with metadata
  • RBAC middleware stub (reads ``X-Role`` header)
  • DEMO_MODE router (loads fixtures from ``demo_fixtures/``)
  • MCP server mounting (official ``mcp`` SDK via Starlette Mount)
  • ``POST /webhook/ingest`` — invokes the compiled LangGraph graph
  • ``GET /health`` — basic health check
  • Uvicorn run block
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, APIRouter
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

logger = logging.getLogger("autoops")
logging.basicConfig(level=logging.INFO)

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
# Core Endpoints
# ---------------------------------------------------------------------------

@app.get("/health", tags=["system"])
async def health_check() -> Dict[str, str]:
    """Basic liveness probe."""
    return {"status": "ok"}


@app.post("/webhook/ingest", tags=["workflow"])
async def webhook_ingest(request: Request) -> JSONResponse:
    """Accept a JSON payload, construct an initial ``AutoOpsState``,
    invoke the compiled LangGraph graph, and return the final state.

    Expected JSON body
    ------------------
    .. code-block:: json

        {
            "payload_type": "onboarding",
            "raw_payload": { ... }
        }
    """
    body: Dict[str, Any] = await request.json()

    # Construct the initial state with required defaults
    initial_state: AutoOpsState = {
        "payload_type": body.get("payload_type", "onboarding"),
        "raw_payload": body.get("raw_payload", body),
        "hire_profile": {},
        "payload_confidence": 0.0,
        "integrity_check_passed": False,
        "historical_context": "NULL_CONTEXT",
        "similarity_gate_passed": False,
        "proposed_plan": {},
        "reflection_passed": False,
        "security_feedback": {},
        "hr_feedback": {},
        "policy_feedback": {},
        "sla_feedback": {},
        "audit_feedback": [],
        "meta_governance_decision": {},
        "condenser_summary": "",
        "iteration_count": 0,
        "execution_log": [],
        "hitl_status": "pending",
        "hitl_approvers": [],
        "zero_shot_success": False,
        "execution_receipt": {},
    }

    try:
        # Invoke the LangGraph compiled graph
        final_state = compiled_graph.invoke(initial_state)
        return JSONResponse(
            content={"status": "completed", "final_state": final_state},
            status_code=200,
        )
    except Exception as exc:
        logger.exception("Graph execution failed")
        return JSONResponse(
            content={"status": "error", "detail": str(exc)},
            status_code=500,
        )


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
