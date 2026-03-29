"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getAuditTrail } from "@/lib/api";
import type { AuditTrailResponse, ExecutionLogEntry, RunState } from "@/types/autoops";

interface NodeDrawerProps {
  nodeId: string | null;
  runId: string | null;
  onClose: () => void;
  latestSnapshot: RunState | null;
}

type AuditTrailWithLLM = AuditTrailResponse & {
  llm_prompt?: unknown;
  llm_response?: unknown;
};

const NODE_LABEL_MAP: Record<string, string> = {
  node_ingestion: "Ingestion Agent",
  node_hard_block: "Hard Block",
  node_hitl_escalation: "HITL Escalation",
  node_rag_retrieval: "RAG Retrieval",
  node_plan_generation: "Plan Generation Agent",
  node_security_guard: "Security Guard Agent",
  node_hr_guard: "HR Guard Agent",
  node_policy_guard: "Policy Guard Agent",
  node_sla_guard: "SLA Guard Agent",
  node_fan_in_reducer: "Fan-In Reducer",
  node_meta_governance: "Meta Governance",
  node_execution: "Execution Agent",
  node_retry: "Retry Agent",
  node_feedback_loop: "Feedback Loop",
  node_complete: "Complete",
};

const STATUS_BADGE_CLASS_MAP: Record<string, string> = {
  idle: "border-slate-400/35 bg-slate-500/10 text-slate-200",
  active: "border-cyan-400/40 bg-cyan-500/12 text-cyan-100",
  started: "border-cyan-400/40 bg-cyan-500/12 text-cyan-100",
  completed: "border-emerald-400/40 bg-emerald-500/12 text-emerald-100",
  failed: "border-rose-400/45 bg-rose-500/14 text-rose-100",
  waiting_hitl: "border-amber-400/45 bg-amber-500/14 text-amber-100 anim-pulse-glow",
};

const LLM_TRACE_NODE_IDS = new Set([
  "node_plan_generation",
  "node_security_guard",
  "node_hr_guard",
  "node_policy_guard",
  "node_sla_guard",
]);

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function toHeadline(value: string): string {
  return value
    .replace(/^node_/, "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getNodeLabel(nodeId: string | null): string {
  if (!nodeId) {
    return "Node Details";
  }
  return NODE_LABEL_MAP[nodeId] ?? `${toHeadline(nodeId)} Agent`;
}

function formatStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function formatTimestamp(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return "N/A";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString();
}

function jsonString(value: unknown): string {
  if (value === undefined || value === null) {
    return "N/A";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function findLatestTimestamp(auditData: AuditTrailResponse | null): string | null {
  if (!auditData) {
    return null;
  }

  const executionLog = Array.isArray(auditData.execution_log) ? auditData.execution_log : [];
  for (let index = executionLog.length - 1; index >= 0; index -= 1) {
    const entry = executionLog[index];
    if (entry?.timestamp) {
      return entry.timestamp;
    }
  }

  const feedbackEntries = Array.isArray(auditData.audit_feedback) ? auditData.audit_feedback : [];
  for (let index = feedbackEntries.length - 1; index >= 0; index -= 1) {
    const entry = feedbackEntries[index];
    if (entry?.timestamp) {
      return entry.timestamp;
    }
  }

  return null;
}

function parseErrorCode(response: unknown): string {
  if (response === null || response === undefined) {
    return "UNKNOWN";
  }

  if (typeof response === "object") {
    const data = response as Record<string, unknown>;
    const nestedError = toRecord(data.error);
    const codeCandidate = data.error_code ?? data.code ?? nestedError?.code;
    if (typeof codeCandidate === "string" && codeCandidate.trim()) {
      return codeCandidate;
    }
    return "UNKNOWN";
  }

  const text = String(response);
  const match = text.match(/(?:error[_\s-]?code|code)\s*[:=]\s*['\"]?([A-Za-z0-9_-]+)/i);
  if (match?.[1]) {
    return match[1];
  }

  return "UNKNOWN";
}

function parseFailedEntries(executionLog: ExecutionLogEntry[]): Array<{
  timestamp: string;
  mcpTool: string;
  errorCode: string;
  responseText: string;
}> {
  return executionLog
    .filter((entry) => entry.status === "failed")
    .map((entry) => {
      let parsedResponse: unknown = entry.response;

      if (typeof entry.response === "string") {
        try {
          parsedResponse = JSON.parse(entry.response);
        } catch {
          parsedResponse = entry.response;
        }
      }

      return {
        timestamp: entry.timestamp,
        mcpTool: entry.mcp_tool,
        errorCode: parseErrorCode(parsedResponse),
        responseText: jsonString(parsedResponse),
      };
    });
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-500/30 bg-gradient-to-br from-slate-900/70 to-slate-950/55 p-4 backdrop-blur-sm">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">{title}</h3>
      {children}
    </section>
  );
}

function JsonBlock({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  return (
    <pre className={cx("overflow-x-auto rounded-lg border border-indigo-300/30 bg-slate-950/90 p-3 font-mono text-xs leading-relaxed text-slate-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.08)]", className)}>
      {jsonString(value)}
    </pre>
  );
}

export default function NodeDrawer({ nodeId, runId, onClose, latestSnapshot }: NodeDrawerProps) {
  const [auditData, setAuditData] = useState<AuditTrailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!nodeId || !runId) {
      setAuditData(null);
      setError(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const activeRunId = runId;

    async function loadAudit(): Promise<void> {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getAuditTrail(activeRunId);
        if (!cancelled) {
          setAuditData(response);
        }
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error ? loadError.message : "Failed to load audit trail";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadAudit();

    return () => {
      cancelled = true;
    };
  }, [nodeId, runId]);

  const isOpen = Boolean(nodeId);
  const status = (auditData?.status ?? "idle").toLowerCase();
  const executionLog = useMemo(
    () => (Array.isArray(auditData?.execution_log) ? auditData.execution_log : []),
    [auditData],
  );
  const failedEntries = useMemo(() => parseFailedEntries(executionLog), [executionLog]);
  const latestTimestamp = useMemo(() => findLatestTimestamp(auditData), [auditData]);
  const metaGovernanceDecision = toRecord(auditData?.meta_governance_decision);

  const auditWithOptionalLlm = auditData as AuditTrailWithLLM | null;
  const llmPrompt = auditWithOptionalLlm?.llm_prompt;
  const llmResponse = auditWithOptionalLlm?.llm_response;
  const isLlmNode = Boolean(nodeId && LLM_TRACE_NODE_IDS.has(nodeId));
  const hasLlmTrace = llmPrompt !== undefined && llmResponse !== undefined;

  const policyFeedback = toRecord(latestSnapshot?.policy_feedback);
  const failedChecks = Array.isArray(policyFeedback?.failed_checks)
    ? (policyFeedback?.failed_checks as Array<Record<string, unknown>>)
    : [];

  const handleCopy = async (value: unknown) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(jsonString(value));
    } catch {
      return;
    }
  };

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent
        side="right"
        className="w-full border-slate-500/35 bg-slate-950/85 p-0 text-zinc-100 backdrop-blur-xl sm:w-[520px] sm:max-w-[520px]"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="gap-3 border-b border-slate-500/30 bg-gradient-to-r from-cyan-500/12 via-indigo-500/10 to-violet-500/12 p-6 text-left">
            <div className="flex items-start justify-between gap-3">
              <SheetTitle className="text-xl font-semibold gradient-text">{getNodeLabel(nodeId)}</SheetTitle>
              <span
                className={cx(
                  "rounded-full border px-2.5 py-1 text-xs font-medium capitalize",
                  STATUS_BADGE_CLASS_MAP[status] ?? "border-zinc-600 bg-zinc-800 text-zinc-200",
                )}
              >
                {formatStatus(status)}
              </span>
            </div>
            <SheetDescription className="font-mono text-xs text-slate-300">
              run_id: {runId ?? "N/A"}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {isLoading ? (
              <div className="rounded-lg border border-slate-500/35 bg-slate-900/55 p-4 text-sm text-slate-300">
                Loading audit trail...
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-rose-400/40 bg-rose-500/12 p-4 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            {!runId && !isLoading && !error ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-500/25 bg-slate-900/40 p-8 text-center">
                <div className="h-10 w-10 rounded-full border border-slate-600 bg-slate-800/60 flex items-center justify-center">
                  <span className="text-lg text-slate-500">⏳</span>
                </div>
                <p className="text-sm font-medium text-slate-300">No run data yet</p>
                <p className="text-xs text-slate-500">Start a demo run to see live state for this node.</p>
              </div>
            ) : null}

            <Section title="State Snapshot">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-slate-500/35 bg-slate-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Timestamp</p>
                  <p className="mt-1 font-mono text-xs text-slate-100">{formatTimestamp(latestTimestamp)}</p>
                </div>
                <div className="rounded-md border border-slate-500/35 bg-slate-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Iteration Count</p>
                  <p className="mt-1 font-mono text-xs text-slate-100">{auditData?.iteration_count ?? "N/A"}</p>
                </div>
              </div>

              {nodeId === "node_plan_generation" ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-300">Reflection Passed:</span>
                    {latestSnapshot && runId ? (
                      <span
                        className={cx(
                          "rounded-full border px-2.5 py-1 text-xs font-medium",
                          latestSnapshot.reflection_passed
                            ? "border-emerald-700 bg-emerald-950 text-emerald-300"
                            : "border-rose-700 bg-rose-950 text-rose-300",
                        )}
                      >
                        {latestSnapshot.reflection_passed ? "true" : "false"}
                      </span>
                    ) : (
                      <span className="rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-400">N/A</span>
                    )}
                  </div>
                  <JsonBlock value={latestSnapshot?.proposed_plan} />
                </>
              ) : null}

              {nodeId === "node_execution" ? (
                <>
                  <div className="space-y-2">
                    <p className="text-sm text-zinc-300">Execution Timeline</p>
                    {executionLog.length === 0 ? (
                      <p className="text-xs text-zinc-500">No execution entries recorded.</p>
                    ) : (
                      <div className="space-y-2">
                        {executionLog.map((entry, index) => (
                          <div
                            key={`${entry.timestamp}-${entry.mcp_tool}-${index}`}
                            className="rounded-md border border-zinc-800 bg-zinc-950 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-mono text-xs text-zinc-200">
                                {entry.system} :: {entry.action}
                              </p>
                              <span
                                className={cx(
                                  "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase",
                                  entry.status === "failed"
                                    ? "border-rose-700 bg-rose-950 text-rose-300"
                                    : "border-emerald-700 bg-emerald-950 text-emerald-300",
                                )}
                              >
                                {entry.status}
                              </span>
                            </div>
                            <p className="mt-2 font-mono text-[11px] text-zinc-400">
                              {formatTimestamp(entry.timestamp)} | tool: {entry.mcp_tool || "N/A"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="mb-2 text-sm text-zinc-300">Execution Receipt</p>
                    <JsonBlock value={latestSnapshot?.execution_receipt} />
                  </div>
                </>
              ) : null}

              {nodeId === "node_security_guard" ? <JsonBlock value={latestSnapshot?.security_feedback} /> : null}

              {nodeId === "node_hr_guard" ? <JsonBlock value={latestSnapshot?.hr_feedback} /> : null}

              {nodeId === "node_policy_guard" ? (
                <>
                  {failedChecks.length === 0 ? (
                    <p className="text-xs text-zinc-500">No failed policy checks recorded.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-md border border-zinc-800">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead className="bg-slate-900/90">
                          <tr>
                            <th className="border-b border-zinc-800 px-3 py-2 text-zinc-300">Check</th>
                            <th className="border-b border-zinc-800 px-3 py-2 text-zinc-300">Reason</th>
                            <th className="border-b border-zinc-800 px-3 py-2 text-zinc-300">Correction</th>
                          </tr>
                        </thead>
                        <tbody>
                          {failedChecks.map((check, index) => (
                            <tr key={`policy-check-${index}`} className="bg-slate-950/70">
                              <td className="border-b border-slate-900 px-3 py-2 font-mono text-slate-100">
                                {String(check.check_name ?? "N/A")}
                              </td>
                              <td className="border-b border-slate-900 px-3 py-2 text-slate-300">
                                {String(check.reason ?? "N/A")}
                              </td>
                              <td className="border-b border-slate-900 px-3 py-2 text-slate-300">
                                {String(check.correction ?? "N/A")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : null}

              {nodeId === "node_sla_guard" ? <JsonBlock value={latestSnapshot?.sla_feedback} /> : null}
            </Section>

            {isLlmNode ? (
              <Section title="LLM Interaction">
                {hasLlmTrace ? (
                  <div className="space-y-3">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm text-zinc-300">Prompt</p>
                        <button
                          type="button"
                          onClick={() => {
                            void handleCopy(llmPrompt);
                          }}
                          className="rounded-md border border-slate-500/35 bg-slate-900/80 px-2 py-1 text-xs text-slate-100 hover:bg-slate-800"
                        >
                          Copy
                        </button>
                      </div>
                      <JsonBlock value={llmPrompt} className="bg-slate-950/95 text-slate-100" />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm text-zinc-300">Response</p>
                        <button
                          type="button"
                          onClick={() => {
                            void handleCopy(llmResponse);
                          }}
                          className="rounded-md border border-slate-500/35 bg-slate-900/80 px-2 py-1 text-xs text-slate-100 hover:bg-slate-800"
                        >
                          Copy
                        </button>
                      </div>
                      <JsonBlock value={llmResponse} className="bg-slate-950/95 text-slate-100" />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-400">LLM trace not available for this run.</p>
                )}
              </Section>
            ) : null}

            {status === "failed" ? (
              <Section title="Error Details">
                {failedEntries.length === 0 ? (
                  <p className="text-sm text-zinc-400">No failed execution log entries found.</p>
                ) : (
                  <div className="space-y-3">
                    {failedEntries.map((entry, index) => (
                      <div
                        key={`${entry.timestamp}-${entry.mcpTool}-${index}`}
                        className="rounded-md border border-rose-400/40 bg-rose-500/12 p-3"
                      >
                        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                          <p className="text-rose-200">
                            Error Code: <span className="font-mono">{entry.errorCode}</span>
                          </p>
                          <p className="text-rose-200">
                            MCP Tool: <span className="font-mono">{entry.mcpTool || "N/A"}</span>
                          </p>
                        </div>
                        <p className="mt-2 font-mono text-[11px] text-rose-200">
                          {formatTimestamp(entry.timestamp)}
                        </p>
                        <pre className="mt-2 overflow-x-auto rounded border border-rose-400/40 bg-rose-950/55 p-2 font-mono text-xs text-rose-100">
                          {entry.responseText}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            ) : null}

            {runId ? (
              <Section title="Routing Decision">
                <p className="text-sm text-slate-200">
                  Priority Rule: <span className="font-medium text-amber-200">{String(metaGovernanceDecision?.priority_rule_applied ?? "N/A")}</span>
                </p>
                <p className="text-sm text-slate-300">
                  Routing: <span className="font-mono text-slate-100">{String(metaGovernanceDecision?.routing ?? "N/A")}</span>
                </p>
                {Array.isArray(metaGovernanceDecision?.all_rejections) ? (
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-zinc-400">All Rejections</p>
                    <ul className="space-y-1 text-xs text-zinc-300">
                      {(metaGovernanceDecision?.all_rejections as unknown[]).map((item, index) => (
                        <li key={`rejection-${index}`} className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono">
                          {String(item)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">No rejection reasons captured.</p>
                )}
              </Section>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
