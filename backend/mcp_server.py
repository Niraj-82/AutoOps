"""
AutoOps Orchestrator — MCP Server
===================================
Implements the Model Context Protocol server using the official ``mcp``
Python SDK (FastMCP high-level API).

Contains:
  • Module-level ``jira_call_count`` counter for the JIRA 503 demo
  • ``generate_capability_token`` — stub for capability-token logic
  • Tool stubs decorated with ``@mcp_server.tool(name="...")`` using
    exact dot-notation names per the spec
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
from typing import Any, Dict, List

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
# MCP Tool Stubs — exact dot-notation names per spec
# ---------------------------------------------------------------------------

@mcp_server.tool(name="jira.provision_access")
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


@mcp_server.tool(name="slack.send_notification")
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


@mcp_server.tool(name="ad.create_account")
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


@mcp_server.tool(name="github.create_repo")
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


# ---------------------------------------------------------------------------
# Missing tool stubs — required by the spec
# ---------------------------------------------------------------------------

@mcp_server.tool(name="slack.create_user")
async def slack_create_user(name: str, email: str, team: str) -> Dict[str, Any]:
    """Create a Slack user account for a new hire.

    STUB: Always returns a mock success response.
    """
    return {"status": "success", "user_id": "slack_user_001"}


@mcp_server.tool(name="github.add_user")
async def github_add_user(name: str, email: str, org: str, team: str, access_level: str) -> Dict[str, Any]:
    """Add a user to a GitHub organization and team.

    STUB: Always returns a mock success response.
    """
    return {"status": "success"}


@mcp_server.tool(name="hr_database.get_hire_profile")
async def hr_database_get_hire_profile(employee_id: str) -> Dict[str, Any]:
    """Fetch the hire profile from the HR database.

    STUB: Returns found=True if employee_id is non-empty.
    """
    return {"found": bool(employee_id.strip()), "employee_id": employee_id}


@mcp_server.tool(name="hr_database.get_buddy_availability")
async def hr_database_get_buddy_availability(buddy_name: str, date_range: str) -> Dict[str, Any]:
    """Check buddy availability for the given date range.

    STUB: Returns available if buddy_name is non-empty.
    """
    return {"available": bool(buddy_name), "conflicts": []}


@mcp_server.tool(name="hr_database.check_license_count")
async def hr_database_check_license_count(system_name: str) -> Dict[str, Any]:
    """Check available license count for a system.

    STUB: Returns 0 available for JIRA, 10 for everything else.
    """
    return {
        "available": 10,
        "total": 100,
    }


@mcp_server.tool(name="policy_db.get_policy_version")
async def policy_db_get_policy_version() -> Dict[str, Any]:
    """Get the current policy version.

    STUB: Returns a fixed version string.
    """
    return {"version": "v1.0.0", "effective_date": "2026-01-01"}


@mcp_server.tool(name="policy_db.get_probationary_rules")
async def policy_db_get_probationary_rules(employment_type: str) -> Dict[str, Any]:
    """Get probationary access rules for the given employment type.

    STUB: Restricts admin for probationary employees.
    """
    if employment_type.lower() == "probationary":
        return {"restricted_access_levels": ["admin"]}
    return {"restricted_access_levels": []}


@mcp_server.tool(name="policy_db.get_dept_prerequisites")
async def policy_db_get_dept_prerequisites(department: str) -> Dict[str, Any]:
    """Get department-specific prerequisites.

    STUB: Returns empty prerequisites list.
    """
    return {"required_completions": []}


@mcp_server.tool(name="role_access_matrix.get_max_access")
async def role_access_matrix_get_max_access(role: str, seniority: str, employment_type: str) -> Dict[str, Any]:
    """Get maximum permitted access levels from the role-access matrix.

    STUB: Returns fixed access levels.
    """
    return {"jira": "developer", "github": "maintainer", "slack": "contributor"}


@mcp_server.tool(name="calendar.check_availability")
async def calendar_check_availability(attendees: List[str], date: str) -> Dict[str, Any]:
    """Check calendar availability for attendees on a given date.

    STUB: Returns a single available slot.
    """
    return {"available_slots": ["10:00-11:00"]}


@mcp_server.tool(name="calendar.create_event")
async def calendar_create_event(title: str, attendees: List[str], slot: str) -> Dict[str, Any]:
    """Create a calendar event.

    STUB: Returns a mock event ID.
    """
    return {"event_id": "evt-001"}


@mcp_server.tool(name="it_queue.get_depth")
async def it_queue_get_depth() -> Dict[str, Any]:
    """Get the current IT provisioning queue depth.

    STUB: Returns a fixed queue depth.
    """
    return {"queue_depth": 10, "estimated_days": 3}
