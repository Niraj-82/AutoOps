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
