"""
AutoOps Orchestrator — MCP Server
===================================
Implements the Model Context Protocol server using the official ``mcp``
Python SDK (FastMCP high-level API).

Contains:
  • Module-level ``jira_call_count`` counter for the JIRA 503 demo
  • ``generate_capability_token`` — stub for capability-token logic
  • 4 tool stubs decorated with ``@mcp_server.tool()``
  • The FastMCP server instance (``mcp_server``) ready to be mounted

JIRA 503 Demo Script
--------------------
``jira.provision_access`` increments ``jira_call_count`` on every call:
  • Calls 1–2  → returns ``{status: 503, error: 'Service Unavailable'}``
  • Call  3+   → returns ``{status: 'success', user_id: 'jira_mock_id'}``
This simulates transient failures that are resolved by the LangGraph
``node_execution → node_retry → node_execution`` loop.
"""

from __future__ import annotations

import datetime
from typing import Any, Dict

from mcp.server.fastmcp import FastMCP


# ---------------------------------------------------------------------------
# MCP Server instance
# ---------------------------------------------------------------------------

mcp_server = FastMCP(
    "AutoOps-MCP",
    stateless_http=True,
    json_response=True,
)

# ---------------------------------------------------------------------------
# Module-level state for JIRA 503 demo
# ---------------------------------------------------------------------------

jira_call_count: int = 0


def reset_jira_call_count() -> None:
    """Reset the JIRA call counter (useful between test runs)."""
    global jira_call_count
    jira_call_count = 0


# ---------------------------------------------------------------------------
# Capability Token Logic (stub)
# ---------------------------------------------------------------------------

def generate_capability_token(user_role: str, action: str) -> Dict[str, Any]:
    """Generate a mock capability token for RBAC enforcement.

    Parameters
    ----------
    user_role : str
        The role of the requesting user (e.g. ``'admin'``, ``'operator'``).
    action : str
        The action being requested (e.g. ``'provision_jira'``).

    Returns
    -------
    dict
        A mock token with ``role``, ``action``, ``granted``, and
        ``expires_at`` fields.
    """
    # Stub: grant all actions for now
    return {
        "role": user_role,
        "action": action,
        "granted": True,
        "expires_at": (
            datetime.datetime.now(datetime.timezone.utc)
            + datetime.timedelta(hours=1)
        ).isoformat(),
    }


# ---------------------------------------------------------------------------
# MCP Tool Stubs
# ---------------------------------------------------------------------------

@mcp_server.tool()
async def jira_provision_access(user_id: str) -> Dict[str, Any]:
    """Provision JIRA access for a new hire.

    Simulates transient 503 errors: the first 2 calls fail with
    ``Service Unavailable``; call 3+ succeeds.

    Parameters
    ----------
    user_id : str
        Identifier of the user to provision.

    Returns
    -------
    dict
        ``{status: 503, error: ...}`` on failure, or
        ``{status: 'success', user_id: 'jira_mock_id'}`` on success.
    """
    global jira_call_count
    jira_call_count += 1

    if jira_call_count <= 2:
        return {"status": 503, "error": "Service Unavailable"}

    return {"status": "success", "user_id": "jira_mock_id"}


@mcp_server.tool()
async def slack_send_notification(channel: str, message: str) -> Dict[str, Any]:
    """Send a notification to a Slack channel.

    STUB: Always returns a mock success response.

    Parameters
    ----------
    channel : str
        Target Slack channel (e.g. ``'#onboarding'``).
    message : str
        Notification message body.
    """
    return {
        "status": "success",
        "channel": channel,
        "message_ts": "1234567890.123456",
    }


@mcp_server.tool()
async def ad_create_account(hire_profile: dict) -> Dict[str, Any]:
    """Create an Active Directory account for a new hire.

    STUB: Always returns a mock success response.

    Parameters
    ----------
    hire_profile : dict
        Dictionary containing at minimum ``first_name``, ``last_name``,
        and ``department``.
    """
    return {
        "status": "success",
        "ad_username": "mock_ad_user",
        "distinguished_name": "CN=Mock User,OU=NewHires,DC=corp,DC=local",
    }


@mcp_server.tool()
async def github_create_repo(repo_name: str) -> Dict[str, Any]:
    """Create a GitHub repository for a new project or team.

    STUB: Always returns a mock success response.

    Parameters
    ----------
    repo_name : str
        Desired repository name.
    """
    return {
        "status": "success",
        "repo_url": f"https://github.com/autoops-corp/{repo_name}",
        "repo_id": "mock_repo_id_12345",
    }
