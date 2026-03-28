import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuditFeedbackEntry, MetaGovernanceDecision } from "@/types/autoops";

interface RejectedPanelProps {
  auditFeedback: AuditFeedbackEntry[] | null;
  metaGovernanceDecision: MetaGovernanceDecision | null;
  isRunActive?: boolean;
  isLoading?: boolean;
}

function cx(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(" ");
}

type GuardRow = {
  key: string;
  name: string;
  verdict: "approve" | "reject";
  reason: string;
};

function getSecurityReason(entry: AuditFeedbackEntry): string {
  const reason = entry.security.rule_triggered;
  return reason && reason.trim().length > 0 ? reason : "No rule triggered";
}

function getHRReason(entry: AuditFeedbackEntry): string {
  return entry.hr.blocking_items.length > 0
    ? entry.hr.blocking_items.join(", ")
    : "No blocking items";
}

function getPolicyReason(entry: AuditFeedbackEntry): string {
  if (entry.policy.failed_checks.length === 0) {
    return "All passed";
  }

  const firstReason = entry.policy.failed_checks[0]?.reason;
  return firstReason && firstReason.trim().length > 0 ? firstReason : "All passed";
}

function getSLAReason(entry: AuditFeedbackEntry): string {
  const reason = entry.sla.timeline_recommendation;
  return reason && reason.trim().length > 0 ? reason : "No recommendation provided";
}

function getGuardRows(entry: AuditFeedbackEntry): GuardRow[] {
  return [
    {
      key: "security",
      name: "Security",
      verdict: entry.security.verdict,
      reason: getSecurityReason(entry),
    },
    {
      key: "hr",
      name: "HR",
      verdict: entry.hr.verdict,
      reason: getHRReason(entry),
    },
    {
      key: "policy",
      name: "Policy",
      verdict: entry.policy.verdict,
      reason: getPolicyReason(entry),
    },
    {
      key: "sla",
      name: "SLA",
      verdict: entry.sla.verdict,
      reason: getSLAReason(entry),
    },
  ];
}

function isIterationApproved(entry: AuditFeedbackEntry): boolean {
  return (
    entry.security.verdict === "approve"
    && entry.hr.verdict === "approve"
    && entry.policy.verdict === "approve"
    && entry.sla.verdict === "approve"
  );
}

function renderVerdictBadge(verdict: "approve" | "reject") {
  const isPass = verdict === "approve";

  return (
    <span
      className={cx(
        "inline-flex min-w-[3.5rem] justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        isPass
          ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-100"
          : "border-rose-400/40 bg-rose-500/12 text-rose-100",
      )}
    >
      {isPass ? "PASS" : "FAIL"}
    </span>
  );
}

function LoadingCard() {
  return (
    <Card className="animate-pulse border-slate-500/30 bg-slate-900/70">
      <CardHeader className="space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

export default function RejectedPanel({
  auditFeedback,
  metaGovernanceDecision,
  isRunActive = false,
  isLoading = false,
}: RejectedPanelProps) {
  const entries = Array.isArray(auditFeedback)
    ? [...auditFeedback].sort((a, b) => a.iteration - b.iteration)
    : [];
  const showSkeleton = (isLoading || isRunActive) && entries.length === 0;
  const priorityRule = metaGovernanceDecision?.priority_rule_applied?.trim();

  return (
    <section className="max-h-[calc(100vh-8.5rem)] overflow-y-auto rounded-2xl border border-slate-500/30 bg-slate-900/40 shadow-glow backdrop-blur-sm">
      <div className="sticky top-0 z-10 border-b border-slate-500/30 bg-slate-900/85 px-4 py-3 backdrop-blur-md">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-cyan-400/0 via-cyan-300/45 to-violet-400/0" aria-hidden="true" />
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200">Shadow Board History</h2>
          <span className="rounded-full border border-slate-500/35 bg-slate-500/12 px-2.5 py-1 text-xs font-semibold text-slate-100">
            {entries.length}
          </span>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {showSkeleton ? (
          <LoadingCard />
        ) : entries.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-500/35 bg-slate-900/70 px-3 py-4 text-sm text-slate-300">
            No audit feedback yet.
          </p>
        ) : (
          entries.map((entry) => {
            const approved = isIterationApproved(entry);
            const statusLabel = approved ? "APPROVED" : "REJECTED";
            const guards = getGuardRows(entry);

            return (
              <details key={`${entry.iteration}-${entry.timestamp}`} className="group overflow-hidden rounded-xl border border-slate-500/30 bg-slate-900/65" open={!approved}>
                <summary className="cursor-pointer list-none bg-gradient-to-r from-slate-900/70 via-slate-900/35 to-slate-900/70 px-4 py-3 marker:content-none">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-sm font-semibold text-slate-100">
                      Iteration {entry.iteration}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <span
                        className={cx(
                          "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
                          approved
                            ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-100"
                            : "border-rose-400/40 bg-rose-500/12 text-rose-100",
                        )}
                      >
                        {statusLabel}
                      </span>
                      <span className="text-xs text-slate-400 transition group-open:rotate-180">v</span>
                    </div>
                  </div>
                </summary>

                <CardContent className="space-y-3 p-4 pt-0">
                  <div className="overflow-x-auto rounded-md border border-slate-500/30">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="bg-slate-900/90 text-slate-300">
                        <tr>
                          <th className="px-3 py-2 font-medium uppercase tracking-wide">Guard</th>
                          <th className="px-3 py-2 font-medium uppercase tracking-wide">Verdict</th>
                          <th className="px-3 py-2 font-medium uppercase tracking-wide">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {guards.map((guard) => (
                          <tr
                            key={guard.key}
                            className={cx(
                              "border-t border-slate-700/55",
                              guard.verdict === "approve" ? "bg-emerald-500/6" : "bg-rose-500/7",
                            )}
                          >
                            <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-200">{guard.name}</td>
                            <td className="whitespace-nowrap px-3 py-2">{renderVerdictBadge(guard.verdict)}</td>
                            <td className="px-3 py-2 text-slate-200">{guard.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {approved ? (
                    <div className="w-full rounded-md border border-emerald-400/35 bg-emerald-500/12 px-3 py-2 text-sm font-medium text-emerald-100">
                      All guards approved - advancing to execution ✓
                    </div>
                  ) : (
                    <div className="w-full rounded-md border border-amber-400/40 bg-gradient-to-r from-amber-500/14 via-orange-500/10 to-amber-500/14 px-3 py-2 text-sm text-amber-100">
                      Meta-governance: {priorityRule && priorityRule.length > 0 ? priorityRule : "Priority rule unavailable"}
                    </div>
                  )}
                </CardContent>
              </details>
            );
          })
        )}
      </div>
    </section>
  );
}
