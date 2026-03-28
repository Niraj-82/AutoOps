"use client";

import { useEffect, useMemo, useState } from "react";
import {
  approveHITL,
  getAuditTrail,
  getRunState,
  resimulate,
} from "@/lib/api";
import type {
  AuditTrailResponse,
  ExecutionLogEntry,
  HITLAction,
  ProposedPlanSystem,
  RunState,
} from "@/types/autoops";

interface HITLApprovalProps {
  runId: string;
  onAction?: (action: HITLAction) => void;
}

type AlertTone = "success" | "error" | "info";

interface AlertState {
  tone: AlertTone;
  message: string;
}

interface TimelineItem {
  entry: ExecutionLogEntry;
  isRetry: boolean;
  isJiraFailure: boolean;
  errorDetail: string | null;
}

const ACCESS_LEVEL_OPTIONS = [
  "viewer",
  "developer",
  "contributor",
  "maintainer",
  "admin",
] as const;

const HITL_STATUS_CLASSES: Record<string, string> = {
  pending: "bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-100 ring-1 ring-amber-400/45 animate-pulse-glow",
  approved: "bg-emerald-500/16 text-emerald-100 ring-1 ring-emerald-400/40",
  rejected: "bg-rose-500/16 text-rose-100 ring-1 ring-rose-400/40",
  timed_out: "bg-slate-500/16 text-slate-100 ring-1 ring-slate-400/35",
};

function normalizeSystems(proposedPlan: RunState["proposed_plan"] | undefined): ProposedPlanSystem[] {
  if (!proposedPlan || typeof proposedPlan !== "object") {
    return [];
  }

  const systems = (proposedPlan as { systems?: unknown }).systems;
  if (!Array.isArray(systems)) {
    return [];
  }

  return systems
    .filter((system): system is Record<string, unknown> => Boolean(system && typeof system === "object"))
    .map((system) => ({
      name: typeof system.name === "string" ? system.name : "unknown-system",
      access_level:
        typeof system.access_level === "string" && system.access_level
          ? system.access_level
          : "viewer",
      fields_to_provision:
        system.fields_to_provision && typeof system.fields_to_provision === "object"
          ? (system.fields_to_provision as Record<string, unknown>)
          : {},
    }));
}

function parseResponsePayload(response: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(response);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getErrorDetail(parsedResponse: Record<string, unknown> | null): string | null {
  if (!parsedResponse) {
    return null;
  }

  const candidates = ["detail", "error", "message", "status_text", "reason"];
  for (const candidate of candidates) {
    const value = parsedResponse[candidate];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function toHitlStatus(value: string | undefined): RunState["hitl_status"] {
  if (value === "pending" || value === "approved" || value === "rejected" || value === "timed_out") {
    return value;
  }
  return "pending";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatStatusLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export default function HITLApproval({ runId, onAction }: HITLApprovalProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string>("unknown");
  const [runState, setRunState] = useState<RunState | null>(null);
  const [auditData, setAuditData] = useState<AuditTrailResponse | null>(null);
  const [editableSystems, setEditableSystems] = useState<ProposedPlanSystem[]>([]);
  const [alert, setAlert] = useState<AlertState | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isResimulating, setIsResimulating] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadData(): Promise<void> {
      setLoading(true);
      setLoadError(null);

      try {
        const [stateResponse, auditResponse] = await Promise.all([
          getRunState(runId),
          getAuditTrail(runId),
        ]);

        // FIXED: Unwrap final_state from the state response.
        const resolvedRunState = stateResponse.final_state ?? null;

        if (!isActive) {
          return;
        }

        setRunStatus(stateResponse.status);
        setRunState(resolvedRunState);
        setAuditData(auditResponse);
        setEditableSystems(normalizeSystems(resolvedRunState?.proposed_plan));
      } catch (error) {
        if (!isActive) {
          return;
        }

        const message = error instanceof Error ? error.message : "Failed to load HITL data.";
        setLoadError(message);
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      isActive = false;
    };
  }, [runId]);

  const timelineItems = useMemo<TimelineItem[]>(() => {
    const attemptsByAction = new Map<string, number>();
    const entries = auditData?.execution_log ?? [];

    return entries.map((entry) => {
      const actionKey = `${entry.system}:${entry.action}`;
      const nextAttempt = (attemptsByAction.get(actionKey) ?? 0) + 1;
      attemptsByAction.set(actionKey, nextAttempt);

      const parsedResponse = parseResponsePayload(entry.response);
      const parsedRetryCount = parsedResponse?.retry_count;
      const retryCount =
        typeof parsedRetryCount === "number"
          ? parsedRetryCount
          : typeof parsedRetryCount === "string"
            ? Number(parsedRetryCount)
            : 0;

      const isRetry =
        nextAttempt > 1 ||
        entry.action.toLowerCase().includes("retry") ||
        entry.response.toLowerCase().includes("retry") ||
        retryCount > 0;

      const isJiraFailure = entry.system.toLowerCase() === "jira" && entry.status === "failed";
      const errorDetail = isJiraFailure ? "503 Service Unavailable" : getErrorDetail(parsedResponse);

      return {
        entry,
        isRetry,
        isJiraFailure,
        errorDetail,
      };
    });
  }, [auditData?.execution_log]);

  const hitlStatus = auditData?.hitl_status ?? runState?.hitl_status ?? "pending";
  const hitlBadgeClass = HITL_STATUS_CLASSES[hitlStatus] ?? HITL_STATUS_CLASSES.pending;
  const hitlApprovers = runState?.hitl_approvers ?? [];
  const hitlApproverSet = new Set(hitlApprovers.map((approver) => approver.toUpperCase()));

  const requiresTwoParty = editableSystems.some((system) => {
    const level = system.access_level.toLowerCase();
    return level === "admin" || level === "root" || level === "superuser";
  });

  async function handleApprove(): Promise<void> {
    setIsApproving(true);
    setAlert(null);

    try {
      // FIXED: Backend uses X-Role header and no JSON body.
      const response = await approveHITL(runId, "IT_MANAGER");

      setAuditData((previous) =>
        previous
          ? {
              ...previous,
              hitl_status: response.hitl_status,
            }
          : previous,
      );

      setRunState((previous) => {
        if (!previous) {
          return previous;
        }

        const nextApprovers = Array.from(new Set([...previous.hitl_approvers, response.approved_by]));
        return {
          ...previous,
          hitl_status: toHitlStatus(response.hitl_status),
          hitl_approvers: nextApprovers,
        };
      });

      setAlert({
        tone: "success",
        message: "Approval recorded. Workflow resuming...",
      });
      onAction?.({ decision: "approve" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Approval failed.";

      if (message.includes("403")) {
        setAlert({ tone: "error", message: "Insufficient privileges — check role." });
      } else {
        setAlert({ tone: "error", message });
      }
    } finally {
      setIsApproving(false);
    }
  }

  function handleRejectPlaceholder(): void {
    setAlert({
      tone: "info",
      message: "Reject action is shown for UX parity, but backend approve endpoint currently records approved only.",
    });
    onAction?.({ decision: "reject" });
  }

  async function handleResimulate(): Promise<void> {
    setIsResimulating(true);
    setAlert(null);

    try {
      // FIXED: Backend uses X-Role header and no JSON body.
      await resimulate(runId, "IT_MANAGER");
      setAuditData((previous) =>
        previous
          ? {
              ...previous,
              hitl_status: "pending",
            }
          : previous,
      );
      setAlert({ tone: "success", message: "Re-simulation running — watch the DAG panel." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Re-simulation failed.";
      if (message.includes("403")) {
        setAlert({ tone: "error", message: "Insufficient privileges — check role." });
      } else {
        setAlert({ tone: "error", message });
      }
    } finally {
      setIsResimulating(false);
    }
  }

  function updateSystemAccessLevel(index: number, nextValue: string): void {
    setEditableSystems((previous) =>
      previous.map((system, systemIndex) =>
        systemIndex === index
          ? {
              ...system,
              access_level: nextValue,
            }
          : system,
      ),
    );
  }

  return (
    <section className="space-y-6">
      <header className="overflow-hidden rounded-2xl border border-indigo-300/35 bg-gradient-to-r from-cyan-500/12 via-indigo-500/12 to-violet-500/16 p-4 shadow-glow backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            Human Approval Required — Run <span className="font-mono">{runId}</span>
          </h1>
          <p className="mt-1 text-sm text-slate-300">Run status: {runStatus}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${hitlBadgeClass}`}
        >
          {formatStatusLabel(hitlStatus)}
        </span>
        </div>
      </header>

      {alert ? (
        <div
          className={`rounded-xl border px-3 py-2 text-sm backdrop-blur ${
            alert.tone === "success"
              ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-100"
              : alert.tone === "error"
                ? "border-rose-400/35 bg-rose-500/12 text-rose-100"
                : "border-amber-400/35 bg-amber-500/12 text-amber-100"
          }`}
          role="alert"
        >
          {alert.message}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-slate-500/35 bg-slate-900/65 p-4 text-sm text-slate-200">
          Loading HITL data...
        </div>
      ) : null}

      {loadError ? (
        <div className="rounded-lg border border-rose-400/40 bg-rose-500/12 p-4 text-sm text-rose-100">
          Failed to load run data: {loadError}
        </div>
      ) : null}

      {!loading && !loadError ? (
        <>
          <section className="rounded-xl border border-slate-500/30 bg-slate-900/60 p-4 shadow-glow backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Summary</p>
            <h2 className="mt-2 text-lg font-medium gradient-text">Why escalation was triggered</h2>
            <p className="mt-3 text-sm leading-6 text-slate-200">
              {runState?.condenser_summary?.trim() ||
                "No condenser summary was provided in this run state."}
            </p>
            <p className="mt-3 text-sm text-slate-300">
              Iteration count: <span className="font-semibold text-slate-100">{runState?.iteration_count ?? 0}</span>
            </p>
          </section>

          <section className="rounded-xl border border-slate-500/30 bg-slate-900/60 p-4 shadow-glow backdrop-blur-sm">
            <h2 className="text-lg font-medium text-slate-100">Execution Log Timeline</h2>
            <p className="mt-1 text-sm text-slate-300">Audit execution trail for this run.</p>

            <div className="mt-4 space-y-4 border-l border-indigo-300/35 pl-5">
              {timelineItems.length === 0 ? (
                <p className="text-sm text-slate-300">No execution log entries are available yet.</p>
              ) : (
                timelineItems.map(({ entry, isRetry, isJiraFailure, errorDetail }) => (
                  <article
                    key={`${entry.timestamp}-${entry.system}-${entry.action}`}
                    className={`relative rounded-lg border p-3 ${
                      isJiraFailure
                        ? "border-rose-400/40 bg-rose-500/12"
                        : isRetry
                          ? "border-amber-400/40 bg-amber-500/12"
                          : "border-slate-500/35 bg-slate-900/80"
                    }`}
                  >
                    <span className={`absolute -left-[29px] top-4 h-2.5 w-2.5 rounded-full ${isRetry ? "bg-amber-300 animate-pulse" : "bg-cyan-300"}`} />

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                      <span className="font-mono">[{formatTimestamp(entry.timestamp)}]</span>
                      <span className="font-mono">[{entry.system}]</span>
                      <span className="font-mono">[{entry.action}]</span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {isRetry ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/18 px-2.5 py-1 text-xs font-semibold uppercase text-amber-100 ring-1 ring-amber-400/45">
                          <span className="inline-block animate-spin">↻</span>
                          retry
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase ring-1 ${
                            entry.status === "success"
                              ? "bg-emerald-500/18 text-emerald-100 ring-emerald-400/45"
                              : "bg-rose-500/18 text-rose-100 ring-rose-400/45"
                          }`}
                        >
                          {entry.status}
                        </span>
                      )}
                    </div>

                    {entry.status === "failed" ? (
                      <div className="mt-3 rounded-md border border-rose-400/40 bg-rose-500/12 p-3">
                        <p className="text-sm font-medium text-rose-100">
                          {isJiraFailure ? "503 Service Unavailable" : "Error details"}
                        </p>
                        <p className="mt-1 text-sm text-rose-50">
                          {errorDetail || "No structured error details were provided."}
                        </p>
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-500/30 bg-slate-900/60 p-4 shadow-glow backdrop-blur-sm">
            <h2 className="text-lg font-medium text-slate-100">Approval Section</h2>
            <p className="mt-1 text-sm text-slate-300">
              Approve requests are submitted with role header X-Role: IT_MANAGER.
            </p>

            {requiresTwoParty ? (
              <div className="mt-4 space-y-2 rounded-md border border-slate-500/30 bg-slate-950/45 p-3">
                {["IT_MANAGER", "HR_MANAGER"].map((role) => {
                  const approved = hitlApproverSet.has(role.toUpperCase());
                  return (
                    <div
                      key={role}
                      className="flex items-center justify-between rounded-md border border-slate-500/30 bg-slate-900/55 px-3 py-2"
                    >
                      <span className="text-sm font-medium text-slate-100">{role}</span>
                      {approved ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/18 px-2 py-1 text-xs font-semibold text-emerald-100 ring-1 ring-emerald-400/45">
                          Approved
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-500/18 px-2 py-1 text-xs font-semibold text-amber-100 ring-1 ring-amber-400/45 animate-pulse">
                          Awaiting...
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  void handleApprove();
                }}
                disabled={isApproving || isResimulating}
                className="ring-gradient inline-flex items-center rounded-lg border border-emerald-300/40 bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isApproving ? "Approving..." : "Approve"}
              </button>

              <button
                type="button"
                onClick={handleRejectPlaceholder}
                className="ring-gradient inline-flex items-center rounded-lg border border-rose-400/45 bg-rose-500/12 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/18"
              >
                Reject
              </button>
            </div>

            <p className="mt-2 text-xs text-slate-400">
              Reject button is present in the UI; current backend endpoint records approvals only.
            </p>
          </section>

          <section className="rounded-xl border border-slate-500/30 bg-slate-900/60 p-4 shadow-glow backdrop-blur-sm">
            <h2 className="text-lg font-medium text-slate-100">Re-Simulate Section</h2>
            <p className="mt-1 text-sm text-slate-300">
              Edit access levels before triggering re-simulation.
            </p>

            <div className="mt-4 space-y-3">
              {editableSystems.length === 0 ? (
                <p className="text-sm text-slate-300">No systems found in proposed plan.</p>
              ) : (
                editableSystems.map((system, index) => (
                  <div
                    key={`${system.name}-${index}`}
                    className="grid gap-2 rounded-md border border-slate-500/30 bg-slate-950/45 p-3 md:grid-cols-[1fr_220px] md:items-center"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{system.name}</p>
                      <p className="text-xs text-slate-400">System access level</p>
                    </div>
                    <select
                      className="ring-gradient rounded-md border border-slate-500/35 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-400/45"
                      value={system.access_level}
                      onChange={(event) => {
                        updateSystemAccessLevel(index, event.target.value);
                      }}
                    >
                      {ACCESS_LEVEL_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                void handleResimulate();
              }}
              disabled={isApproving || isResimulating}
              className="ring-gradient mt-4 inline-flex items-center rounded-lg border border-amber-300/40 bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isResimulating ? "Re-simulating..." : "Re-Simulate"}
            </button>
          </section>
        </>
      ) : null}
    </section>
  );
}
