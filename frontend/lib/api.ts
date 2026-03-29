import type {
  AuditTrailResponse,
  MetricsSummary,
  RunStateResponse,
} from "../types/autoops";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const DEMO_WEBHOOK_SECRET = "autoops_demo_secret_2026";

export interface DemoIngestPayload {
  type: "onboarding";
  name: string;
  role: string;
  department: string;
  seniority: string;
  employment_type: string;
  start_date: string;
  manager: string;
  required_systems: string[];
  compliance_flags: string[];
}

function toYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getNextMondayDateYYYYMMDD(fromDate: Date = new Date()): string {
  const nextMonday = new Date(fromDate);
  const dayOfWeek = nextMonday.getDay();
  let daysUntilMonday = (1 - dayOfWeek + 7) % 7;
  if (daysUntilMonday === 0) {
    daysUntilMonday = 7;
  }
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
  return toYYYYMMDD(nextMonday);
}

export function buildDemoOnboardingPayload(startDate: string = getNextMondayDateYYYYMMDD()): DemoIngestPayload {
  return {
    type: "onboarding",
    name: "Arjun Mehta",
    role: "DevOps Engineer",
    department: "Engineering",
    seniority: "mid",
    employment_type: "probationary",
    start_date: startDate,
    manager: "Priya Sharma",
    required_systems: ["slack", "github", "jira"],
    compliance_flags: [],
  };
}

function requireParam(name: string, value: string): void {
  if (!value) {
    throw new Error(`${name} is required`);
  }
}

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = "";
    try {
      const data = (await response.json()) as { detail?: string };
      detail = data.detail ?? JSON.stringify(data);
    } catch {
      detail = await response.text();
    }
    throw new Error(`API request failed: ${response.status}${detail ? ` - ${detail}` : ""}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

export async function generateHMACFromString(bodyString: string, secret: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is unavailable in this environment");
  }

  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(bodyString));
  const bytes = new Uint8Array(signature);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function generateHMAC(payload: object, secret: string): Promise<string> {
  const bodyString = JSON.stringify(payload);
  return generateHMACFromString(bodyString, secret);
}

export async function healthCheck(): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>("/health");
}

export async function getRunState(runId: string): Promise<RunStateResponse> {
  requireParam("runId", runId);

  return fetchJSON<RunStateResponse>(`/run/${encodeURIComponent(runId)}/state`);
}

export async function getAuditTrail(runId: string): Promise<AuditTrailResponse> {
  requireParam("runId", runId);

  return fetchJSON<AuditTrailResponse>(`/run/${encodeURIComponent(runId)}/audit`);
}

export async function getMetricsSummary(): Promise<MetricsSummary> {
  return fetchJSON<MetricsSummary>("/metrics/summary");
}

export async function approveHITL(
  runId: string,
  role: string,
): Promise<{ run_id: string; hitl_status: string; approved_by: string }> {
  requireParam("runId", runId);
  requireParam("role", role);

  return fetchJSON<{ run_id: string; hitl_status: string; approved_by: string }>(
    `/run/${encodeURIComponent(runId)}/hitl/approve`,
    {
      method: "POST",
      headers: {
        "X-Role": role,
      },
    },
  );
}

export async function resimulate(
  runId: string,
  role: string,
): Promise<{ run_id: string; status: string; triggered_by: string }> {
  requireParam("runId", runId);
  requireParam("role", role);

  return fetchJSON<{ run_id: string; status: string; triggered_by: string }>(
    `/run/${encodeURIComponent(runId)}/hitl/resimulate`,
    {
      method: "POST",
      headers: {
        "X-Role": role,
      },
    },
  );
}

export async function triggerDemoRun(
  payload: DemoIngestPayload = buildDemoOnboardingPayload(),
  signature?: string,
): Promise<{ run_id: string; status: string }> {
  const bodyString = JSON.stringify(payload);
  const resolvedSignature = signature ?? await generateHMACFromString(bodyString, DEMO_WEBHOOK_SECRET);

  requireParam("signature", resolvedSignature);

  return fetchJSON<{ run_id: string; status: string }>("/webhook/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Signature": resolvedSignature,
    },
    body: bodyString,
  });
}

