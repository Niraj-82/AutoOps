import httpx
import os
from dotenv import load_dotenv
load_dotenv()

token = os.getenv("GITHUB_PAT")
org = os.getenv("GITHUB_ORG")
username = "am1trajput"

resp = httpx.put(
    f"https://api.github.com/orgs/{org}/memberships/{username}",
    headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json"
    },
    json={"role": "member"}
)

print(resp.status_code)
print(resp.text)