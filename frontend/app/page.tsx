"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AutoOpsDAG from "@/components/dag/AutoOpsDAG";
import DAGErrorBoundary from "@/components/dag/DAGErrorBoundary";
import NodeDrawer from "@/components/dag/NodeDrawer";
import ImpactPanel from "@/components/panels/ImpactPanel";
import RejectedPanel from "@/components/panels/RejectedPanel";
import SignalPanel from "@/components/panels/SignalPanel";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { buildDemoOnboardingPayload, healthCheck, triggerDemoRun } from "@/lib/api";
import { useRealtimeNodes, type RealtimeConnectionStatus } from "@/hooks/useRealtimeNodes";
import { useRunState } from "@/hooks/useRunState";
import type { MetaGovernanceDecision } from "@/types/autoops";

function toMetaGovernanceDecision(value: unknown): MetaGovernanceDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const routing = record.routing;
  const priorityRuleApplied = record.priority_rule_applied;
  const reason = record.reason;

  if (
    (routing !== "advance" && routing !== "loop" && routing !== "escalate")
    || typeof priorityRuleApplied !== "string"
    || typeof reason !== "string"
  ) {
    return null;
  }

  const allRejections = Array.isArray(record.all_rejections)
    ? record.all_rejections.filter((item): item is string => typeof item === "string")
    : undefined;

  return {
    routing,
    priority_rule_applied: priorityRuleApplied,
    all_rejections: allRejections,
    reason,
  };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function toPercent(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  // Backend can send confidence either as 0-1 or 0-100.
  const normalized = value <= 1 ? value * 100 : value;
  return clampPercent(normalized);
}

function getStatusBadgeClass(status: string | null): string {
  if (status === "active" || status === "started") {
    return "border-blue-600 bg-blue-950 text-blue-300 animate-pulse";
  }

  if (status === "completed") {
    return "border-emerald-600 bg-emerald-950 text-emerald-300";
  }

  if (status === "error" || status === "failed") {
    return "border-rose-600 bg-rose-950 text-rose-300";
  }

  return "border-zinc-700 bg-zinc-800 text-zinc-300";
}

function normalizeRunStatus(status: string | null): string | null {
  if (status === "failed") {
    return "error";
  }

  return status;
}

function formatStatus(status: string | null): string {
  if (!status) {
    return "—";
  }

  if (status === "failed") {
    return "Error";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function RealtimeStatusBadge({ status }: { status: RealtimeConnectionStatus }) {
  if (status === "connected") {
    return (
      <Badge className="inline-flex items-center gap-2 border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-emerald-100 backdrop-blur">
        <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
        Realtime Connected
      </Badge>
    );
  }

  if (status === "reconnecting") {
    return (
      <Badge className="inline-flex items-center gap-2 border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-amber-100 backdrop-blur">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" aria-hidden="true" />
        Reconnecting...
      </Badge>
    );
  }

  return (
    <Badge className="inline-flex items-center gap-2 border-slate-500/35 bg-slate-900/60 px-3 py-1.5 text-slate-200 backdrop-blur">
      <span className="h-2 w-2 rounded-full bg-zinc-500" aria-hidden="true" />
      Disconnected
    </Badge>
  );
}

type ToastState = {
  variant: "success" | "error";
  message: string;
} | null;

type BackendHealthState = "checking" | "healthy" | "down";

function HealthStatusBadge({ status }: { status: BackendHealthState }) {
  if (status === "healthy") {
    return (
      <Badge className="inline-flex items-center gap-2 border-cyan-400/35 bg-cyan-500/10 px-3 py-1.5 text-cyan-100 backdrop-blur">
        <Activity className="h-3.5 w-3.5" aria-hidden="true" />
        API Healthy
      </Badge>
    );
  }

  if (status === "checking") {
    return (
      <Badge className="inline-flex items-center gap-2 border-indigo-400/35 bg-indigo-500/10 px-3 py-1.5 text-indigo-100 backdrop-blur">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Checking API...
      </Badge>
    );
  }

  return (
    <Badge className="inline-flex items-center gap-2 border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-rose-100 backdrop-blur">
      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
      API Unreachable
    </Badge>
  );
}

function StatusTile({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`glass-card rounded-xl p-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-glow ${className ?? ""}`}>
      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isTriggeringDemo, setIsTriggeringDemo] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [backendHealth, setBackendHealth] = useState<BackendHealthState>("checking");
  const {
    nodeStatusMap,
    currentRunId,
    latestSnapshot,
    connectionStatus,
  } = useRealtimeNodes();
  const {
    runState,
    runStatus,
    auditData,
    isLoading,
  } = useRunState(currentRunId);

  const effectiveSnapshot = latestSnapshot ?? runState;
  const normalizedRunStatus = normalizeRunStatus(runStatus);

  const isRunActive = normalizedRunStatus === "active" || normalizedRunStatus === "started";

  const confidencePercent = useMemo(() => {
    const sourceConfidence = latestSnapshot?.payload_confidence ?? runState?.payload_confidence;
    return toPercent(sourceConfidence ?? null);
  }, [latestSnapshot, runState]);

  const integrityPassed = latestSnapshot?.integrity_check_passed ?? runState?.integrity_check_passed ?? null;

  const metaGovernanceDecision = useMemo(
    () => toMetaGovernanceDecision(auditData?.meta_governance_decision),
    [auditData?.meta_governance_decision],
  );

  const hitlPending = effectiveSnapshot?.hitl_status === "pending";

  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  useEffect(() => {
    let cancelled = false;

    async function checkApiHealth(): Promise<void> {
      try {
        const response = await healthCheck();
        if (!cancelled) {
          setBackendHealth(response.status === "ok" ? "healthy" : "down");
        }
      } catch {
        if (!cancelled) {
          setBackendHealth("down");
        }
      }
    }

    void checkApiHealth();
    const interval = window.setInterval(() => {
      void checkApiHealth();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const showToast = (nextToast: Exclude<ToastState, null>) => {
    setToast(nextToast);
    window.setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  const handleDemoRun = async () => {
    setIsTriggeringDemo(true);
    try {
      const payload = buildDemoOnboardingPayload();
      const response = await triggerDemoRun(payload);
      showToast({
        variant: "success",
        message: `Demo run started: ${response.run_id}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start demo run";
      showToast({ variant: "error", message });
    } finally {
      setIsTriggeringDemo(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-2.8rem)] text-zinc-100">
      <div className="fixed right-5 top-[4.15rem] z-50 flex flex-wrap items-center justify-end gap-2 anim-slide-in">
        <HealthStatusBadge status={backendHealth} />
        <RealtimeStatusBadge status={connectionStatus} />
      </div>

      <div className="h-full p-4 md:p-5">
        <section className="gradient-border anim-fade-in-up mb-4 overflow-hidden rounded-2xl p-4 md:p-5">
          <div className="pointer-events-none absolute inset-0 opacity-45" aria-hidden="true" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">AutoOps Command Center</p>
              <h1 className="mt-1 text-2xl font-semibold md:text-3xl">
                <span className="gradient-text">Autonomous Provisioning Graph</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                Live orchestration dashboard for ingestion, guardrail checks, HITL escalation, and execution telemetry.
              </p>
            </div>

            {hitlPending && currentRunId ? (
              <Link
                href={`/hitl/${encodeURIComponent(currentRunId)}`}
                className="ring-gradient inline-flex items-center gap-2 rounded-xl border border-amber-300/35 bg-amber-500/12 px-3.5 py-2 text-sm font-semibold text-amber-100 transition hover:-translate-y-0.5 hover:bg-amber-500/18"
              >
                Review HITL Escalation
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : null}
          </div>

          <div className="relative mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatusTile label="Run ID">
              <p className="font-mono text-sm text-zinc-100">{currentRunId ?? "-"}</p>
            </StatusTile>

            <StatusTile label="Status">
              <div className="flex items-center gap-2">
                <Badge className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${getStatusBadgeClass(normalizedRunStatus)}`}>
                  {formatStatus(normalizedRunStatus)}
                </Badge>
                {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden="true" /> : null}
              </div>
            </StatusTile>

            <StatusTile label="Confidence Score">
              <div className="space-y-1.5">
                <Progress
                  value={confidencePercent}
                  className="h-2.5 w-full rounded-full bg-slate-800/80"
                  indicatorClassName="bg-gradient-to-r from-cyan-400 via-indigo-400 to-violet-400 transition-[width] duration-500"
                />
                <p className="text-xs text-slate-300">{Math.round(confidencePercent)}%</p>
              </div>
            </StatusTile>

            <StatusTile label="Integrity Check">
              <div className="flex items-center gap-2 text-sm">
                {integrityPassed === true ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                    <span className="text-emerald-200">Passed</span>
                  </>
                ) : integrityPassed === false ? (
                  <>
                    <XCircle className="h-4 w-4 text-rose-400" aria-hidden="true" />
                    <span className="text-rose-200">Failed</span>
                  </>
                ) : (
                  <span className="text-slate-400">-</span>
                )}
              </div>
            </StatusTile>
          </div>
        </section>

        <Separator className="mb-4 bg-gradient-to-r from-cyan-400/0 via-cyan-300/35 to-violet-400/0" />

        <section className="grid h-[calc(100vh-12rem)] grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <aside className="min-h-0 w-full xl:w-[320px]">
            <SignalPanel latestSnapshot={effectiveSnapshot} isLoading={isLoading} />
          </aside>

          <div className="min-w-0 space-y-4">
            <div className="h-[600px] overflow-hidden rounded-2xl border border-slate-600/30 bg-slate-950/35 shadow-glow">
              <DAGErrorBoundary>
                <AutoOpsDAG
                  nodeStatusMap={nodeStatusMap}
                  onNodeClick={(id) => {
                    if (id === "node_hitl_escalation" && currentRunId) {
                      router.push(`/hitl/${encodeURIComponent(currentRunId)}`);
                      return;
                    }
                    setSelectedNodeId(id);
                  }}
                  currentRunId={currentRunId}
                />
              </DAGErrorBoundary>
            </div>

            <RejectedPanel
              auditFeedback={auditData?.audit_feedback ?? null}
              metaGovernanceDecision={metaGovernanceDecision}
              isRunActive={isRunActive}
              isLoading={isLoading}
            />
          </div>

          <aside className="min-h-0 w-full xl:w-[360px]">
            <ImpactPanel />
          </aside>
        </section>
      </div>

      <NodeDrawer
        nodeId={selectedNodeId}
        runId={currentRunId}
        latestSnapshot={effectiveSnapshot}
        onClose={() => setSelectedNodeId(null)}
      />

      {isDemoMode ? (
        <button
          type="button"
          onClick={() => {
            void handleDemoRun();
          }}
          disabled={isTriggeringDemo}
          className="anim-fade-in-up fixed bottom-5 right-5 z-40 rounded-xl border border-cyan-300/40 bg-gradient-to-r from-cyan-500 via-indigo-500 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow-glow-strong transition duration-200 hover:scale-[1.02] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isTriggeringDemo ? "Starting demo..." : "Start Demo Run"}
        </button>
      ) : null}

      {toast ? (
        <div
          className={`anim-slide-in fixed bottom-20 right-5 z-50 max-w-[min(92vw,30rem)] rounded-xl border px-3 py-2.5 text-sm shadow-xl backdrop-blur ${
            toast.variant === "success"
              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
              : "border-rose-400/40 bg-rose-500/15 text-rose-100"
          }`}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      ) : null}
    </main>
  );
}
