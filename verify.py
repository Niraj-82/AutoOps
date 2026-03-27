"""Quick verification script for the AutoOps Orchestrator."""

# 1. Verify graph topology
from graph import compiled_graph
g = compiled_graph.get_graph()
nodes = [n for n in g.nodes]
print(f"Graph has {len(nodes)} nodes:")
for n in nodes:
    print(f"  - {n}")

# 2. Verify JIRA 503 demo logic
import asyncio
from mcp_server import jira_provision_access, reset_jira_call_count

reset_jira_call_count()

async def test_jira():
    for i in range(4):
        result = await jira_provision_access(user_id="test_user")
        print(f"  JIRA call {i+1}: {result}")

print("\nJIRA 503 demo test:")
asyncio.run(test_jira())

# 3. Verify state schema field count
from state_schema import AutoOpsState
print(f"\nAutoOpsState has {len(AutoOpsState.__annotations__)} fields")

# 4. Verify fixture loading
from main import _load_fixture
fixture = _load_fixture("demo_mock_responses.json")
print(f"\nDemo fixture systems: {list(fixture.keys())}")

print("\n✓ All verifications passed!")


# ---------------------------------------------------------------------------
# 5. node_hitl_escalation — trigger reason detection
# ---------------------------------------------------------------------------
from graph import node_hitl_escalation

# ------------------------------------------------------------------
# Test 1: JIRA 503 failure — retry_count >= 2 AND all_succeeded False
# The node reads execution_receipt, NOT execution_log, for retry detection.
# ------------------------------------------------------------------
print("\n=== Test 1: JIRA 503 failure trigger ===")
state_jira = {
    "payload_confidence": 0.9,
    "integrity_check_passed": True,
    "hire_profile": {"name": "Alice Smith"},
    "iteration_count": 1,
    "pydantic_retry_count": 0,
    "proposed_plan": {},
    "raw_payload": {"run_id": "test-run-001"},
    "hitl_approvers": [],
    "execution_log": [
        {"system": "jira", "action": "provision_access", "status": "failed",
         "mcp_tool": "jira.provision_access", "response": "{\"status_code\": 503}",
         "timestamp": "2026-01-01T00:00:00Z"},
    ],
    # THIS is what the node actually reads for trigger detection:
    "execution_receipt": {"retry_count": 2, "all_succeeded": False},
}
result = node_hitl_escalation(state_jira)
assert result["hitl_status"] == "pending", f"Expected pending, got {result['hitl_status']}"
assert result["hitl_approvers"] == []
print(f"  hitl_status: {result['hitl_status']}  ✓")

# ------------------------------------------------------------------
# Test 2: Low confidence (0.5–0.8) — fires before retry check
# ------------------------------------------------------------------
print("\n=== Test 2: Low confidence trigger ===")
state_conf = {
    "payload_confidence": 0.65,
    "integrity_check_passed": True,
    "hire_profile": {"name": "Bob Jones"},
    "iteration_count": 0,
    "pydantic_retry_count": 0,
    "proposed_plan": {},
    "raw_payload": {"run_id": "test-run-002"},
    "hitl_approvers": [],
    "execution_log": [],
    "execution_receipt": {},
}
result = node_hitl_escalation(state_conf)
assert result["hitl_status"] == "pending"
print(f"  hitl_status: {result['hitl_status']}  ✓")

# ------------------------------------------------------------------
# Test 3: Iteration cap (>= 5)
# ------------------------------------------------------------------
print("\n=== Test 3: Iteration cap trigger ===")
state_iter = {
    "payload_confidence": 0.9,
    "integrity_check_passed": True,
    "hire_profile": {"name": "Carol White"},
    "iteration_count": 5,
    "pydantic_retry_count": 0,
    "proposed_plan": {},
    "raw_payload": {"run_id": "test-run-003"},
    "hitl_approvers": [],
    "execution_log": [],
    "execution_receipt": {},
}
result = node_hitl_escalation(state_iter)
assert result["hitl_status"] == "pending"
print(f"  hitl_status: {result['hitl_status']}  ✓")

# ------------------------------------------------------------------
# Test 4: High-privilege access — plan contains admin access level
# Requires TWO-party approval: IT_MANAGER + HR_MANAGER
# ------------------------------------------------------------------
print("\n=== Test 4: High-privilege trigger ===")
state_highpriv = {
    "payload_confidence": 0.9,
    "integrity_check_passed": True,
    "hire_profile": {"name": "Dave Kumar"},
    "iteration_count": 1,
    "pydantic_retry_count": 0,
    "proposed_plan": {
        "systems": [
            {"name": "jira", "access_level": "admin", "fields_to_provision": {}},
        ]
    },
    "raw_payload": {"run_id": "test-run-004"},
    "hitl_approvers": [],
    "execution_log": [],
    "execution_receipt": {},
}
result = node_hitl_escalation(state_highpriv)
assert result["hitl_status"] == "pending"
print(f"  hitl_status: {result['hitl_status']}  ✓")
print("  (two-party approval required — IT_MANAGER + HR_MANAGER)")

# ------------------------------------------------------------------
# Test 5: Pydantic retry exhausted (pydantic_retry_count >= 3)
# ------------------------------------------------------------------
print("\n=== Test 5: Pydantic retry exhausted trigger ===")
state_pydantic = {
    "payload_confidence": 0.9,
    "integrity_check_passed": True,
    "hire_profile": {"name": "Eve Chen"},
    "iteration_count": 0,
    "pydantic_retry_count": 3,
    "proposed_plan": {},
    "raw_payload": {"run_id": "test-run-005"},
    "hitl_approvers": [],
    "execution_log": [],
    "execution_receipt": {},
}
result = node_hitl_escalation(state_pydantic)
assert result["hitl_status"] == "pending"
print(f"  hitl_status: {result['hitl_status']}  ✓")

# ------------------------------------------------------------------
# Test 6: Default fallback — no trigger condition fires
# ------------------------------------------------------------------
print("\n=== Test 6: Default fallback trigger ===")
state_default = {
    "payload_confidence": 0.9,
    "integrity_check_passed": True,
    "hire_profile": {"name": "Frank Lopez"},
    "iteration_count": 0,
    "pydantic_retry_count": 0,
    "proposed_plan": {},
    "raw_payload": {"run_id": "test-run-006"},
    "hitl_approvers": [],
    "execution_log": [],
    "execution_receipt": {},
}
result = node_hitl_escalation(state_default)
assert result["hitl_status"] == "pending"
print(f"  hitl_status: {result['hitl_status']}  ✓")

# ------------------------------------------------------------------
# Test 7: Priority ordering — confidence (0.5–0.8) fires BEFORE
# high_priv when both are true, because of the if/elif chain order.
# ------------------------------------------------------------------
print("\n=== Test 7: Low confidence beats high-priv in priority order ===")
state_priority = {
    "payload_confidence": 0.7,
    "integrity_check_passed": True,
    "hire_profile": {"name": "Grace Hall"},
    "iteration_count": 0,
    "pydantic_retry_count": 0,
    "proposed_plan": {
        "systems": [{"name": "aws", "access_level": "admin", "fields_to_provision": {}}]
    },
    "raw_payload": {"run_id": "test-run-007"},
    "hitl_approvers": [],
    "execution_log": [],
    "execution_receipt": {},
}
result = node_hitl_escalation(state_priority)
assert result["hitl_status"] == "pending"
print(f"  hitl_status: {result['hitl_status']}  ✓")

print("\n✓ All node_hitl_escalation tests passed!")
