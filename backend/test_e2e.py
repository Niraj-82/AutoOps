import os
import time
import json
import hmac
import hashlib
import httpx
from dotenv import load_dotenv

# Load the secret from your .env file
load_dotenv()
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "dummy_secret")
BASE_URL = "http://localhost:8000"

def test_full_workflow():
    print("🚀 Starting End-to-End Backend Verification...")

    # 1. Prepare the mock HR payload
    payload = {
        "payload_type": "onboarding",
        "data": "Jane Doe, Software Engineer, Engineering, Senior, Full-time, 2024-04-01, John Smith, Jira/Slack, SOC2"
    }

    body_bytes = json.dumps(payload).encode("utf-8") 

    signature = hmac.new(WEBHOOK_SECRET.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()

    response = httpx.post(
        f"{BASE_URL}/webhook/ingest", 
        content=body_bytes,
        headers={"x-webhook-signature": signature, "Content-Type": "application/json"}
    )
    
    if response.status_code != 202:
        print(f"❌ Webhook failed: {response.text}")
        return

    data = response.json()
    run_id = data["run_id"]
    print(f"✅ Webhook accepted! Background task started with run_id: {run_id}")

    # 4. Poll the State Endpoint
    print("\n⏳ 2. Polling graph state (waiting for completion)...")
    for _ in range(10): # Poll for up to 10 seconds
        time.sleep(1)
        state_resp = httpx.get(f"{BASE_URL}/run/{run_id}/state")
        if state_resp.status_code == 200:
            state_data = state_resp.json()
            status = state_data.get("status")
            print(f"   ↳ Status: {status}")
            
            if status in ["completed", "error"]:
                print("\n🎉 3. Workflow Finished!")
                final_state = state_data.get("final_state", {})
                print(f"   ↳ Final Confidence Score: {final_state.get('payload_confidence')}")
                print(f"   ↳ Execution Log Length: {len(final_state.get('execution_log', []))}")
                break
        else:
            print(f"   ↳ State not found yet...")

    # 5. Check Metrics
    print("\n📊 4. Checking Metrics Summary...")
    metrics_resp = httpx.get(f"{BASE_URL}/metrics/summary")
    print(f"   ↳ {metrics_resp.json()}")

if __name__ == "__main__":
    test_full_workflow()