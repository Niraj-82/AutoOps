import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { RunState } from "@/types/autoops";

interface SignalPanelProps {
  latestSnapshot: RunState | null;
  isLoading?: boolean;
}

function cx(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(" ");
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => toStringValue(item))
    .filter((item): item is string => Boolean(item));
}

function formatEmploymentType(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string | null): string {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getEmploymentBadgeClass(employmentType: string): string {
  switch (employmentType) {
    case "full_time":
      return "border-emerald-400/35 bg-emerald-500/12 text-emerald-100";
    case "contractor":
      return "border-cyan-400/35 bg-cyan-500/12 text-cyan-100";
    case "probationary":
      return "border-amber-400/35 bg-amber-500/12 text-amber-100";
    default:
      return "border-slate-500/35 bg-slate-500/12 text-slate-200";
  }
}

function getGaugeColorClass(percentage: number): string {
  if (percentage < 50) {
    return "text-rose-500";
  }
  if (percentage < 80) {
    return "text-amber-500";
  }
  return "text-emerald-500";
}

function getAutonomyBadge(percentage: number): { label: string; className: string } {
  if (percentage < 50) {
    return {
      label: "BLOCKED",
      className: "border-rose-400/40 bg-rose-500/12 text-rose-100",
    };
  }
  if (percentage < 80) {
    return {
      label: "HITL REQUIRED",
      className: "border-amber-400/40 bg-amber-500/12 text-amber-100",
    };
  }
  return {
    label: "FULLY AUTONOMOUS",
    className: "border-emerald-400/40 bg-emerald-500/12 text-emerald-100",
  };
}

function getSystemChipClass(system: string): string {
  const value = system.toLowerCase();

  if (value.includes("github")) {
    return "border-indigo-400/35 bg-indigo-500/12 text-indigo-100";
  }

  if (value.includes("jira")) {
    return "border-cyan-400/35 bg-cyan-500/12 text-cyan-100";
  }

  if (value.includes("slack")) {
    return "border-violet-400/35 bg-violet-500/12 text-violet-100";
  }

  return "border-slate-500/35 bg-slate-500/12 text-slate-100";
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-600/30 py-2 transition-colors duration-150 hover:border-cyan-300/30 last:border-b-0 last:pb-0">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-right text-sm text-slate-100">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-500/30 bg-gradient-to-br from-slate-900/70 to-slate-950/60 p-4 backdrop-blur-sm">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">{title}</h3>
      {children}
    </section>
  );
}

function ThreeRowSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border border-slate-500/30 bg-slate-900/75 p-4">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  );
}

export default function SignalPanel({ latestSnapshot, isLoading = false }: SignalPanelProps) {
  const profile = toRecord(latestSnapshot?.hire_profile);

  const name = toStringValue(profile?.name) ?? "N/A";
  const role = toStringValue(profile?.role) ?? "N/A";
  const department = toStringValue(profile?.department) ?? "N/A";
  const employmentType = toStringValue(profile?.employment_type) ?? "unknown";
  const startDate = formatDate(toStringValue(profile?.start_date));
  const manager = toStringValue(profile?.manager) ?? "N/A";
  const requiredSystems = toStringArray(profile?.required_systems);
  const complianceFlags = toStringArray(profile?.compliance_flags);

  const rawConfidence = typeof latestSnapshot?.payload_confidence === "number"
    ? latestSnapshot.payload_confidence
    : 0;
  const confidencePercent = clampPercent(rawConfidence * 100);
  const confidenceRounded = Math.round(confidencePercent);
  const gaugeColorClass = getGaugeColorClass(confidencePercent);
  const autonomyBadge = getAutonomyBadge(confidencePercent);

  const integrityPassed = latestSnapshot?.integrity_check_passed === true;

  return (
    <div className="space-y-4 rounded-2xl border border-slate-500/30 bg-slate-900/40 p-4 shadow-glow backdrop-blur-sm">
      <div className="rounded-lg bg-gradient-to-r from-cyan-500/12 via-indigo-500/12 to-violet-500/12 px-3 py-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200">Signals</h2>
      </div>

      <Separator className="bg-gradient-to-r from-cyan-400/0 via-cyan-300/30 to-indigo-400/0" />

      <Section title="Incoming Payload">
        {isLoading ? (
          <ThreeRowSkeleton />
        ) : latestSnapshot === null ? (
          <p className="rounded-md border border-dashed border-slate-500/35 bg-slate-900/55 px-3 py-4 text-sm text-slate-300">
            Waiting for run payload...
          </p>
        ) : (
          <div className="space-y-3 rounded-lg border border-slate-500/35 bg-slate-900/75 p-4">
            <Row label="Name" value={name} />
            <Row label="Role" value={role} />
            <Row label="Department" value={department} />

            <div className="flex items-center justify-between border-b border-slate-600/30 py-2">
              <span className="text-xs uppercase tracking-wide text-slate-400">Employment</span>
              <span
                className={cx(
                  "rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
                  getEmploymentBadgeClass(employmentType),
                )}
              >
                {formatEmploymentType(employmentType)}
              </span>
            </div>

            <Row label="Start Date" value={startDate} />
            <Row label="Manager" value={manager} />

            <div className="space-y-2 pt-1">
              <p className="text-xs uppercase tracking-wide text-slate-400">Required Systems</p>
              {requiredSystems.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {requiredSystems.map((system) => (
                    <span
                      key={system}
                      className={cx(
                        "rounded-full border px-2.5 py-1 text-xs capitalize",
                        getSystemChipClass(system),
                      )}
                    >
                      {system}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">None</p>
              )}
            </div>

            <div className="space-y-2 pt-1">
              <p className="text-xs uppercase tracking-wide text-slate-400">Compliance Flags</p>
              {complianceFlags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {complianceFlags.map((flag) => (
                    <span
                      key={flag}
                      className="rounded-full border border-rose-400/35 bg-rose-500/12 px-2.5 py-1 text-xs text-rose-100"
                    >
                      {flag}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">None</p>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section title="Confidence Gauge">
        {isLoading ? (
          <ThreeRowSkeleton />
        ) : latestSnapshot === null ? (
          <p className="rounded-md border border-dashed border-slate-500/35 bg-slate-900/55 px-3 py-4 text-sm text-slate-300">
            Confidence will appear after ingestion.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="relative h-36 w-36 animate-fade-in-up">
                <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    fill="none"
                    strokeWidth="10"
                    className="text-slate-800"
                    stroke="currentColor"
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    fill="none"
                    strokeWidth="10"
                    strokeLinecap="round"
                    pathLength="100"
                    strokeDasharray={`${confidencePercent} 100`}
                    className={gaugeColorClass}
                    stroke="currentColor"
                    style={{ transition: "stroke-dasharray 480ms ease" }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-semibold text-slate-100">{confidenceRounded}%</span>
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <span
                className={cx(
                  "rounded-full border px-4 py-2 text-sm font-semibold uppercase tracking-wide shadow-glow",
                  autonomyBadge.className,
                )}
              >
                {autonomyBadge.label}
              </span>
            </div>
          </div>
        )}
      </Section>

      <Section title="Integrity Check">
        {isLoading ? (
          <ThreeRowSkeleton />
        ) : latestSnapshot === null ? (
          <p className="rounded-md border border-dashed border-slate-500/35 bg-slate-900/55 px-3 py-4 text-sm text-slate-300">
            Integrity verdict pending.
          </p>
        ) : integrityPassed ? (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-400/35 bg-emerald-500/12 p-4 text-emerald-100">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <p className="text-sm font-medium">Webhook signature verified</p>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-rose-400/35 bg-rose-500/14 p-4 text-rose-100">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p className="text-sm font-medium">Signature invalid — graph halted</p>
          </div>
        )}
      </Section>
    </div>
  );
}
