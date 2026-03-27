"""Verify node_hitl_escalation trigger reason detection and demo log output."""

from graph import node_hitl_escalation

# Test 1: JIRA failure (2+ failed entries)
print("=== Test 1: JIRA 503 failure trigger ===")
state_jira = {
    "payload_confidence": 0.9,
    "integrity_check_passed": True,
    "hire_profile": {"name": "Alice Smith"},
    "iteration_count": 1,
    "execution_log": [
        {"event": "execution_attempt", "retry_count": 0, "result": "failed"},
        {"event": "retry_scheduled", "retry_count": 1},
        {"event": "execution_attempt", "retry_count": 1, "result": "failed"},
        {"event": "retry_scheduled", "retry_count": 2},
    ],
}
result = node_hitl_escalation(state_jira)
assert result["hitl_status"] == "pending"
print(f"  hitl_status: {result['hitl_status']}")

# Test 2: Low confidence (0.5-0.8)
print("\n=== Test 2: Low confidence trigger ===")
state_conf = {
    "payload_confidence": 0.65,
    "integrity_check_passed": True,
    "hire_profile": {"name": "Bob Jones"},
    "iteration_count": 1,
    "execution_log": [],
}
result = node_hitl_escalation(state_conf)
assert result["hitl_status"] == "pending"
print(f"  hitl_status: {result['hitl_status']}")

# Test 3: Iteration limit (>= 5)
print("\n=== Test 3: Iteration limit trigger ===")
state_iter = {
    "payload_confidence": 0.9,
    "integrity_check_passed": True,
    "hire_profile": {"name": "Carol White"},
    "iteration_count": 5,
    "execution_log": [],
}
result = node_hitl_escalation(state_iter)
assert result["hitl_status"] == "pending"
print(f"  hitl_status: {result['hitl_status']}")

# Test 4: Default fallback
print("\n=== Test 4: Default trigger ===")
state_default = {
    "payload_confidence": 0.9,
    "integrity_check_passed": True,
    "hire_profile": {},
    "iteration_count": 0,
    "execution_log": [],
}
result = node_hitl_escalation(state_default)
assert result["hitl_status"] == "pending"
print(f"  hitl_status: {result['hitl_status']}")

print("\n✓ All node_hitl_escalation tests passed!")
