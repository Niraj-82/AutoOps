import httpx
import os
from dotenv import load_dotenv
load_dotenv()

token = os.getenv("SLACK_BOT_TOKEN")

resp = httpx.post(
    "https://slack.com/api/chat.postMessage",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "channel": "#general",
        "text": "🚀 AutoOps Slack test working!"
    }
)

print(resp.json())