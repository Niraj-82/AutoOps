# AutoOps Orchestrator

> **Deterministic Multi-Agent Enterprise Workflow Automation**
> ET AI Hackathon 2026 · Track 2: Agentic AI for Autonomous Enterprise Workflows · Avataar.ai Partner Edition

[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2ea44f)](https://github.com)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB)](https://python.org)
[![LangGraph](https://img.shields.io/badge/LangGraph-0.4+-1C3C3C)](https://python.langchain.com/docs/langgraph)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

> **⚠️ ADVISORY MODE — Final execution authority for irreversible or high-privilege actions rests exclusively with authenticated human operators.**

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
  - [Core Philosophy](#core-philosophy)
  - [Technology Stack](#technology-stack)
  - [7-Node Pipeline](#7-node-pipeline)
  - [Shadow Board](#shadow-board-4-guard-parallel-validation)
  - [HITL Escalation](#hitl-escalation)
  - [Security Model](#security-model)
- [Demo Scenarios](#demo-scenarios)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Backend Setup](#backend-setup)
  - [Frontend Setup](#frontend-setup)
  - [Running the Demo](#running-the-demo)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Impact Model](#impact-model)
- [CI/CD](#cicd)
- [Team Notes](#team-notes)

---

## Overview

AutoOps Orchestrator is a **deterministic, stateful, multi-agent workflow engine** purpose-built for enterprise HR and operations automation. It is not a chatbot, not a single-prompt wrapper, and not a thin UI layer over an LLM API.

Every decision the system makes is **traceable, typed, auditable, and recoverable**. A 7-node LangGraph DAG orchestrates two tiers of LLMs, four parallel compliance guard agents, a zero-trust MCP server, real-time WebSocket visualization, and human-in-the-loop escalation — all backed by Supabase's PostgreSQL, pgvector, and Realtime infrastructure.

**Primary scenario: Employee Onboarding with JIRA 503 Recovery.** Secondary scenarios: Meeting-to-Action with ambiguous ownership, and SLA Breach Prevention via procurement bottleneck.

---

## Architecture

### Core Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Determinism over probabilism** | All routing decisions (confidence gates, priority hierarchy, TTL fallback) are hardcoded Python logic — never delegated to an LLM |
| **Typed schemas as agent contracts** | Every inter-node handoff is Pydantic-validated; invalid outputs trigger structured self-correction, not crashes |
| **Provable auditability** | LangGraph checkpoints the full state to PostgreSQL at every node transition — complete reconstruction at any point |
| **Graceful degradation** | Every failure has a defined recovery path: retry → escalate → fallback. The graph never crashes; it routes |
| **Cost-efficient LLM routing** | Tier 1 (Groq/Llama 3) for speed-critical structured tasks; Tier 2 (Claude 3.5 Sonnet) for complex reasoning |
| **Zero-trust tool execution** | Per-agent MCP capability tokens enforced at the gateway level, not the prompt level |

### Technology Stack

| Service | Role |
|---------|------|
| **LangGraph** | State machine DAG with cyclical error-recovery loops, parallel node execution, fan-in reducers, and Postgres checkpointing |
| **FastAPI** | API gateway + LangGraph executor. Persistent process (not serverless). Webhook ingestion, RBAC, WebSocket push |
| **Supabase** | PostgreSQL (states, audit logs) + pgvector (workflow embeddings) + Auth (JWT/RBAC) + Realtime (live DAG push) |
| **Groq — Llama 3** | Tier-1 LLM: payload parsing, confidence scoring, anomaly detection, state condensation. Typical latency < 400ms |
| **Anthropic — Claude 3.5 Sonnet** | Tier-2 LLM: plan drafting + self-reflection, temperature 0.0 for deterministic output |
| **MCP Server (FastMCP)** | Zero-trust tool gateway. Per-agent capability tokens. Mock integrations for JIRA, Slack, GitHub, AD, HR DB, Calendar |
| **Next.js 14 + React Flow** | SSR frontend. Live DAG node-state visualization via Supabase Realtime WebSocket. Shadcn/ui + Tailwind |

### 7-Node Pipeline

```
HR Webhook ──► [N1 Ingestion] ──► [N2 RAG Retrieval] ──► [N3 Plan Gen + Reflection]
                    │                                              │
               confidence                                   fan-out (parallel)
               gate <50%                             ┌──────┬──────┬──────┐
                    │                              [SEC] [HR] [POL] [SLA]
                    ▼                                └──────┴──────┴──────┘
              HARD BLOCK                                     │ fan-in
                                                     [N4 Meta-Governance]
                                                      advance │ loop↩ │ escalate
                                                             [N5 MCP Execution]
                                                        503 retry ◄──► [Retry Node]
                                                           success ▼
                                                     [N7 Feedback Loop] ──► pgvector
                                                             │
                                                     any failure ──► [N6 HITL Escalation]
```

#### Node 1 — Ingestion, Payload Integrity & Confidence Triage

- **Webhook signature validation**: HMAC-SHA256 with shared secret. Failed integrity → immediate graph halt.
- **Payload type discrimination**: `onboarding | meeting_transcript | sla_check` routes to the correct parser.
- **Llama 3 structured extraction**: Produces a fully typed `hire_profile` object via Groq.
- **Confidence gate**:
  - `> 0.80` → Full autonomous execution
  - `0.50–0.80` → HITL mandatory before any irreversible action
  - `< 0.50` → Hard block; structured error returned to originating system

#### Node 2 — RAG Retrieval with Similarity Gate

- Embeds `hire_profile` and queries pgvector for historical onboarding workflows.
- **Cosine similarity threshold: 0.82** — prevents mismatched templates from poisoning plan generation.
- `NULL_CONTEXT` fallback enables Claude to reason from first principles on cold starts.
- Zero-shot successes tagged for elevated future retrieval weight (continuous learning).

#### Node 3 — Plan Generation + Recursive Self-Reflection

- **Claude 3.5 Sonnet at temperature 0.0** drafts the full provisioning plan as a Pydantic-validated JSON object.
- **Pydantic validation interceptor** returns structured errors back to Claude for autonomous self-correction (up to 3 retries).
- **Reflection Node**: Claude evaluates its own plan against a 6-point goal checklist before submission.
- **Lossless Condenser** (Llama 3): Compresses prior rejection reasons into a precise summary string passed to the next iteration.

#### Node 4 — Shadow Board (4-Guard Parallel Validation)

See [Shadow Board section](#shadow-board-4-guard-parallel-validation) below.

#### Node 5 — Zero-Trust MCP Execution

- Sequential provisioning: **Slack → GitHub → JIRA** (partial completion is preserved).
- JIRA 503 error triggers the **Retry Node** with exponential backoff.
- Second failure escalates to Node 6 HITL; execution log records exactly what succeeded.
- React Flow visualization shows the live recovery loop in real time.

#### Node 6 — HITL Escalation

- Triggers on: JIRA retry exhaustion, low confidence (50–80%), iteration cap reached, or high-privilege access.
- Dispatches a structured Resend email brief to approvers.
- **Two-party approval** required for `admin | root | superuser` access levels.
- Per-request RBAC revalidation; 4-hour TTL fallback marks `timed_out` (never auto-executes).

#### Node 7 — Post-Execution Feedback Loop

- Writes complete execution record back to pgvector for future RAG retrieval.
- Tags zero-shot successes for score-boost in future similarity searches.
- Generates downloadable audit PDF artifact via ReportLab.
- Writes workflow metadata for metrics aggregation.

---

### Shadow Board: 4-Guard Parallel Validation

All four guards execute concurrently as independent LangGraph nodes with isolated state keys.

| Guard | Key Checks | MCP Tools Used |
|-------|-----------|---------------|
| **Security & IAM** | Role-access matrix, least-privilege, probationary restrictions, cross-system consistency | `role_access_matrix.get_max_access` |
| **HR & Availability** | Buddy availability, software license headcount, department capacity | `hr_database.get_buddy_availability`, `hr_database.check_license_count` |
| **Policy Compliance** | PDPB data minimisation, policy version stamp, probationary rules, dept prerequisites | `policy_db.get_policy_version`, `policy_db.get_probationary_rules`, `policy_db.get_dept_prerequisites` |
| **SLA Feasibility** | IT queue depth vs. start date, calendar slot availability | `it_queue.get_depth`, `calendar.check_availability` |

**Meta-governance priority hierarchy** (deterministic Python, never LLM):

```
Security  >  Policy  >  SLA  >  HR
```

A Security veto cannot be overridden. If all guards approve, graph advances to execution. If `iteration_count ≥ 5`, graph escalates regardless.

---

### HITL Escalation

```
Escalation triggers:
  • JIRA retry exhausted (503 × 2)
  • payload_confidence 0.50–0.80
  • iteration_count ≥ 5
  • any system requests admin | root | superuser access

Standard failure   → Single IT Manager approval
High-privilege     → IT Manager + HR Manager (two-party)
TTL (4 hours)      → Marks timed_out; never auto-executes
```

The HITL approval UI at `/hitl/[run_id]` allows operators to review the full execution log, edit access levels, approve, reject, or trigger re-simulation — all RBAC-gated.

---

### Security Model

| Layer | Implementation |
|-------|---------------|
| **Webhook integrity** | HMAC-SHA256 signature on every inbound payload |
| **MCP tool scoping** | Per-agent capability tokens; enforcement at gateway level |
| **Per-request RBAC** | Fresh JWT validation on every HITL action (not per-session) |
| **Re-entry closure** | Manually overridden payloads still re-run integrity + anomaly checks |
| **Iteration cap** | `iteration_count ≤ 5` prevents infinite LLM loops / API cost drain |
| **Two-party approval** | Admin access requires dual-approver confirmation |
| **Immutable audit** | LangGraph checkpoint at every node transition in PostgreSQL |

---

## Demo Scenarios

### Scenario 1: Employee Onboarding + JIRA Recovery *(Primary)*

1. POST webhook with new hire payload → Node 1 scores `>80%` confidence.
2. RAG retrieves a matching historical Engineering hire (similarity `0.91`).
3. Shadow Board approves on first pass — all four guards green.
4. Slack ✓ and GitHub ✓ provision successfully. JIRA returns **503**.
5. Retry Node fires; second attempt also fails. Escalation path activates.
6. React Flow shows the live red-node recovery loop.
7. IT Manager approves via HITL UI. JIRA provisioned manually.

### Scenario 2: Meeting-to-Action with Ambiguous Owner

- Low-confidence action item (`50–72%`) triggers HITL before task assignment.
- System flags the ambiguous ownership with a structured clarification request.

### Scenario 3: SLA Breach Prevention

- Procurement stall detected; SLA Guard rejects plan (IT queue too deep).
- Meta-governance loops back; condenser passes timeline constraint to next iteration.
- Alternative plan with partial provisioning and expedited follow-up generated.

---

## Project Structure

```
autoops/
├── backend/
│   ├── main.py                  # FastAPI app, endpoints, background task runner
│   ├── graph.py                 # LangGraph DAG — all 7 nodes + routers
│   ├── state_schema.py          # AutoOpsState TypedDict (frozen, authoritative)
│   ├── pydantic_models.py       # ProvisioningPlan + PlanSystem schemas
│   ├── mcp_server.py            # FastMCP server with zero-trust tool stubs
│   ├── supabase_client.py       # Supabase client initialization
│   ├── requirements.txt         # Python dependencies
│   ├── verify.py                # Contract verification + HITL node tests
│   ├── generate_signature.py    # HMAC webhook signature generator utility
│   ├── test_e2e.py              # End-to-end integration test
│   └── demo_fixtures/
│       ├── demo_mock_responses.json
│       ├── node_ingestion_response.json
│       ├── node_plan_generation_response.json
│       ├── node_security_guard_response.json
│       ├── node_hr_guard_response.json
│       ├── node_policy_guard_response.json
│       ├── node_sla_guard_response.json
│       ├── node_execution_response.json
│       ├── node_rag_retrieval_response.json
│       ├── node_meta_governance_response.json
│       └── node_feedback_loop_response.json
├── frontend/
│   ├── app/
│   │   ├── page.tsx             # Main command center dashboard
│   │   ├── layout.tsx           # Root layout with Advisory Banner
│   │   └── hitl/[run_id]/
│   │       └── page.tsx         # HITL approval workspace
│   ├── components/
│   │   ├── dag/
│   │   │   ├── AutoOpsDAG.tsx   # React Flow live DAG visualization
│   │   │   ├── NodeDrawer.tsx   # Right-side detail drawer per node
│   │   │   └── DAGErrorBoundary.tsx
│   │   ├── hitl/
│   │   │   └── HITLApproval.tsx # Full HITL review + approval UI
│   │   ├── panels/
│   │   │   ├── SignalPanel.tsx  # Left column: signals, confidence gauge
│   │   │   ├── ImpactPanel.tsx  # Right column: impact simulator + metrics
│   │   │   └── RejectedPanel.tsx # Shadow Board history
│   │   ├── shared/
│   │   │   └── AdvisoryBanner.tsx
│   │   └── ui/                  # Shadcn/ui primitives
│   ├── hooks/
│   │   ├── useRealtimeNodes.ts  # Supabase Realtime WebSocket hook
│   │   └── useRunState.ts       # SWR polling hook for run state
│   ├── lib/
│   │   └── api.ts               # Typed API client (all endpoints)
│   └── types/
│       └── autoops.ts           # Full TypeScript types for all state shapes
└── .github/
    └── workflows/
        └── verify.yml           # CI: import safety, contract verification, retry logic, secret scan
```

---

## Getting Started

### Prerequisites

- Python ≥ 3.10
- Node.js ≥ 18
- A Supabase project (free tier is sufficient for demo)
- Groq API key (free tier available at console.groq.com)
- Anthropic API key

### Backend Setup

```bash
# 1. Clone and navigate to backend
cd backend

# 2. Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy environment template
cp .env.example .env
# Edit .env with your keys (see Environment Variables section)

# 5. Run contract verification (validates graph topology + node logic)
python verify.py

# 6. Start the server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**DEMO_MODE** (no API keys required for demo):

```bash
DEMO_MODE=TRUE uvicorn main:app --reload
```

In DEMO_MODE, all Groq and Anthropic API calls are intercepted by a local mock router returning pre-computed fixture responses. The full LangGraph DAG still executes; all nodes run; all Pydantic validation fires.

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Copy environment template
cp .env.local.example .env.local
# Set NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_SUPABASE_* vars

# Start development server
npm run dev
# Open http://localhost:3000
```

### Running the Demo

#### Option A — Start Demo Run (UI)

1. Open the dashboard at `http://localhost:3000`.
2. Click **"Start Demo Run"** (bottom-right floating button).
3. Watch the React Flow DAG animate live as nodes execute.
4. The pre-configured payload uses `employment_type: probationary` + `required_systems: ["slack", "github", "jira"]`.
5. JIRA will 503 twice (demo fixture), triggering the retry loop and HITL escalation.

#### Option B — Direct Webhook (curl)

```bash
# Generate HMAC signature
python backend/generate_signature.py

# POST the webhook (replace SIGNATURE with output above)
curl -X POST http://localhost:8000/webhook/ingest \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: SIGNATURE" \
  -d '{"name":"Arjun Mehta","role":"DevOps Engineer","department":"Engineering","seniority":"mid","employment_type":"probationary","start_date":"2026-06-02","manager":"Priya Sharma","required_systems":["slack","github","jira"],"compliance_flags":[]}'
```

#### Option C — Postman

Import `backend/POSTMAN_DUMP.json` into Postman. The collection covers all endpoints including HITL approval.

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/webhook/ingest` | HMAC header | Submit HR payload; returns `run_id` immediately (202) |
| `GET` | `/run/{run_id}/state` | — | Current run state + final_state snapshot |
| `GET` | `/run/{run_id}/audit` | RBAC | Full audit trail: execution log, feedback, HITL status |
| `POST` | `/run/{run_id}/hitl/approve` | RBAC (`X-Role`) | Approve HITL escalation |
| `POST` | `/run/{run_id}/hitl/resimulate` | RBAC (`X-Role`) | Trigger re-simulation |
| `GET` | `/metrics/summary` | — | Aggregate run metrics |
| `GET` | `/health` | — | Liveness probe |
| `GET` | `/demo/{node_name}` | — | Fixture responses (DEMO_MODE only) |
| `/mcp/*` | MCP endpoints | Token | Zero-trust tool gateway |

**RBAC in DEMO_MODE**: Pass `X-Role: IT_MANAGER` header (no JWT required).

**RBAC in Production**: Bearer JWT validated against Supabase Auth; `operator_role` claim extracted from `app_metadata`.

---

## Environment Variables

### Backend (`.env`)

```env
# Mode
DEMO_MODE=TRUE                          # Set FALSE for production

# Security
WEBHOOK_SECRET=autoops_demo_secret_2026 # HMAC signing secret

# LLM APIs
GROQ_API_KEY=gsk_...
ANTHROPIC_API_KEY=sk-ant-...

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key

# Email (HITL escalation)
RESEND_API_KEY=re_...

# Optional
CORS_ALLOW_ORIGINS=http://localhost:3000
GITHUB_ORG=your-org
```

### Frontend (`.env.local`)

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

---

## Impact Model

| Metric | Manual Provisioning | AutoOps |
|--------|--------------------|---------| 
| Time per hire | 4.5 hours | 8 minutes |
| Cost per hire | ₹5,400 (₹1,200/hr IT admin) | ₹180 (LLM API) |
| Time-to-productive | 3 business days | Same day |
| Error / mis-provisioning rate | ~8% | ~1.2% |
| Error remediation cost | ₹25,000/incident | — |

**Annual savings (200 hires/year):**

```
IT labor saving:     (₹5,400 - ₹180) × 200 = ₹10.44 lakh
Compliance saving:   6.8 incidents avoided × ₹25,000 = ₹1.70 lakh
─────────────────────────────────────────────────────────────────
Total annual impact: ₹12.14 lakh  +  unmeasured same-day productivity gains
```

**HITL path EV** (15% of runs require HITL, 90% resolved within TTL):

```
EV = 0.90 × (₹5,400 - ₹1,080) = ₹3,888 expected saving per escalated case
```

*Assumptions stated explicitly. All figures are adjustable in the Impact Simulator panel in the frontend.*

---

## CI/CD

GitHub Actions workflow (`.github/workflows/verify.yml`) runs on every push and pull request:

1. **Import safety check** — validates Supabase env vars and clean module imports.
2. **Contract verification** — runs `verify.py`: graph topology, JIRA 503 demo, state schema field count, fixture loading, and 7 `node_hitl_escalation` trigger tests.
3. **Retry logic check** — asserts `_mcp_call` returns 503 on calls 1–2 and success on call 3.
4. **Secret scan** — grep for leaked GitHub tokens (`ghp_`) and Slack tokens (`xoxb-`).

---

## Team Notes

### Commit Protocol

Keep commits granular and feature-mapped for the judge review:

```bash
git commit -m "feat: implement Node 1 payload confidence scorer"
git commit -m "feat: add Shadow Board security IAM guard with policy rule P-SEC"
git commit -m "fix: enforce per-request RBAC revalidation on HITL endpoint"
git commit -m "feat: add React Flow WebSocket node state visualization"
```

### Demo Pre-Seeding Checklist

- [ ] `DEMO_MODE=TRUE` in backend `.env`
- [ ] JIRA mock configured for 503 × 2 then success
- [ ] One pgvector record pre-loaded at cosine similarity `0.91` for the demo hire
- [ ] IT Manager HITL account open on a second browser tab
- [ ] Impact Simulator set to 200 hires/year
- [ ] `WEBHOOK_SECRET=autoops_demo_secret_2026` (matches `generate_signature.py` default)

### Surprise Scenario Prep

| Scenario | Expected Behaviour |
|----------|-------------------|
| Buddy on PTO | HR Guard rejects; suggests alternative buddy from same team |
| Unknown system in `required_systems` | Policy Guard rejects with `P-POL-UNKNOWN-SYSTEM` flag |
| No action items in transcript | Confidence < 50%; hard block + structured clarification request |
| Probationary hire requests admin access | Security Guard rejects with `P-SEC-PROB-01`; Policy Guard secondary rejection |
| Policy version mismatch | Policy Guard rejects with `P-POL-VER-01`; forces re-draft |

---

## Architecture Diagram

See `AutoOps_Architecture.pdf` (included in this repository) for the full 4-page system architecture:

- **Page 1** — Cover & key metrics
- **Page 2** — Full system architecture (3-layer: External Triggers → API Gateway → Agent Pipeline → Data Layer)
- **Page 3** — 7-Node Pipeline DAG with all routing paths annotated
- **Page 4** — Technology stack, security model, and impact quantification

---

*AutoOps Orchestrator · ET AI Hackathon 2026 · Track 2 · Version 3.0 Final · March 2026*
*Internal team document — all architectural decisions are final pending team review.*
