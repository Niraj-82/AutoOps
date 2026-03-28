"""
AutoOps — HMAC-SHA256 Webhook Signature Generator
===================================================
Generates valid signatures for testing webhook ingestion via Postman or curl.

Usage:
    python generate_signature.py

IMPORTANT:
    • The JSON body sent to /webhook/ingest MUST be byte-identical to
      what this script signs.  Use separators=(",", ":") and no extra
      whitespace / newlines when sending from Postman (paste the printed
      payload verbatim into the raw body).
    • If you change the payload, re-run this script and use the new signature.
"""

import hmac
import hashlib
import json
import os

SECRET = os.getenv("WEBHOOK_SECRET", "autoops_demo_secret_2026")


def generate_signature(payload: dict, secret: str = SECRET) -> str:
    """Return the HMAC-SHA256 hex digest for *payload*.

    Parameters
    ----------
    payload : dict
        The JSON body that will be POSTed to ``/webhook/ingest``.
    secret : str
        The shared webhook secret (defaults to env var or demo value).

    Returns
    -------
    str
        Hex-encoded HMAC-SHA256 signature.
    """
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(
        secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    return signature


if __name__ == "__main__":
    payload={"name":"am1trajput",
    "email":"amitrajputdeonia00@gmail.com",
    "role":"Software Engineer",
    "department":"Engineering",
    "seniority":"junior",
    "employment_type":"full_time",
    "start_date":"2026-06-01",
    "manager":"Manager",
    "required_systems":["slack","github"],
    "compliance_flags":[]}

    sig = generate_signature(payload)
    compact_body = json.dumps(payload, separators=(",", ":"))

    print("=" * 60)
    print("  AUTOOPS WEBHOOK SIGNATURE GENERATOR")
    print("=" * 60)
    print()
    print(f"Secret:    {SECRET}")
    print(f"Signature: {sig}")
    print()
    print("--- Postman Raw Body (paste exactly) ---")
    print(compact_body)
    print()
    print("--- Postman Headers ---")
    print(f"  Content-Type:        application/json")
    print(f"  x-webhook-signature: {sig}")
    print()
    print("--- curl example ---")
    print(
        f'curl -X POST http://localhost:8000/webhook/ingest \\\n'
        f'  -H "Content-Type: application/json" \\\n'
        f'  -H "x-webhook-signature: {sig}" \\\n'
        f"  -d '{compact_body}'"
    )
