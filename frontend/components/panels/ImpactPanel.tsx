"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getMetricsSummary } from "@/lib/api";
import type { MetricsSummary } from "@/types/autoops";

export const ANNUAL_HIRES = 200;

const MANUAL_COST_PER_HIRE = 5400;
const AUTOOPS_COST_PER_HIRE = 180;
const METRICS_POLL_INTERVAL_MS = 10000;

const annualSaving = (MANUAL_COST_PER_HIRE - AUTOOPS_COST_PER_HIRE) * ANNUAL_HIRES;

function formatCurrencyINR(value: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value)}`;
}

function formatCount(value: number | undefined): string {
  if (typeof value !== "number") {
    return "--";
  }

  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

function AnimatedNumber({ value }: { value: number | undefined }) {
  const [displayValue, setDisplayValue] = useState(0);
  const isNumeric = typeof value === "number";

  useEffect(() => {
    if (!isNumeric) {
      setDisplayValue(0);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const duration = 520;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setDisplayValue(Math.round((value ?? 0) * progress));
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isNumeric, value]);

  if (!isNumeric) {
    return <>--</>;
  }

  return <>{formatCount(displayValue)}</>;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-500/30 bg-slate-950/60 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-base font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function MetricsTile({
  label,
  value,
  badge,
}: {
  label: string;
  value: number | undefined;
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-500/30 bg-gradient-to-br from-slate-900/75 to-slate-950/65 p-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-glow">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
        {badge}
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-100"><AnimatedNumber value={value} /></p>
    </div>
  );
}

function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

function MetricsSection({
  metrics,
  isLoading,
  hasError,
}: {
  metrics: MetricsSummary | undefined;
  isLoading: boolean;
  hasError: boolean;
}) {
  return (
    <Card className="border-slate-500/30 bg-slate-900/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-200">
            Demo Session Stats (Live)
          </CardTitle>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-100">
            <span className="h-2.5 w-2.5 animate-pulse-glow rounded-full bg-emerald-400" aria-hidden="true" />
            Live
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading && !metrics ? (
          <MetricsSkeleton />
        ) : hasError ? (
          <p className="rounded-md border border-rose-400/35 bg-rose-500/12 px-3 py-2 text-sm text-rose-100">
            Unable to load live metrics.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <MetricsTile
              label="Total Workflows"
              value={metrics?.total_runs}
              badge={
                metrics && metrics.errored > 0 ? (
                  <span className="rounded-full border border-rose-400/35 bg-rose-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-100">
                    {metrics.errored} errored
                  </span>
                ) : undefined
              }
            />
            <MetricsTile label="Completed" value={metrics?.completed} />
            <MetricsTile label="In Progress" value={metrics?.in_progress} />
            <MetricsTile label="HITL Pending" value={metrics?.hitl_pending} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ImpactPanel() {
  const {
    data: metrics,
    error,
    isLoading,
  } = useSWR<MetricsSummary>("autoops-metrics-summary", getMetricsSummary, {
    refreshInterval: METRICS_POLL_INTERVAL_MS,
    revalidateOnFocus: false,
  });

  return (
    <section className="space-y-4 rounded-2xl border border-slate-500/30 bg-slate-900/40 p-4 shadow-glow backdrop-blur-sm">
      <div className="rounded-lg bg-gradient-to-r from-indigo-500/12 via-cyan-500/12 to-emerald-500/12 px-3 py-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200">Impact Simulator</h2>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="border-slate-500/35 bg-slate-900/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-100">Manual IT Provisioning</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <StatRow label="Time per hire" value="4.5 hours" />
            <StatRow label="Cost per hire" value="₹5,400" />
            <StatRow label="Time to productive" value="3 business days" />
            <p className="pt-1 text-xs text-slate-400">Assumption: mid-level IT admin at ₹1,200/hr</p>
          </CardContent>
        </Card>

        <Card className="border-cyan-400/40 bg-gradient-to-br from-cyan-500/16 via-indigo-500/14 to-violet-500/14 ring-1 ring-cyan-300/25">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-cyan-50">
              <Zap className="h-4 w-4 text-cyan-200" aria-hidden="true" />
              AutoOps Orchestrator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <StatRow label="Time per hire" value="8 minutes" />
            <StatRow label="API cost per hire" value="₹180" />
            <StatRow label="Time to productive" value="Same day" />
            <p className="pt-1 text-xs text-cyan-100/85">
              Assumption: Groq + Anthropic API costs at current rates
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-emerald-400/35 bg-gradient-to-r from-emerald-500/14 via-cyan-500/10 to-indigo-500/12">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-[0.15em] text-emerald-100">
            Annual Savings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-4xl font-bold leading-tight text-transparent bg-gradient-to-r from-emerald-200 via-cyan-200 to-indigo-200 bg-clip-text drop-shadow-[0_0_18px_rgba(16,185,129,0.3)]">
            {formatCurrencyINR(annualSaving)} annual saving
          </p>
          <p className="text-sm text-emerald-100">(₹5,400 - ₹180) x 200 hires</p>
          <p className="text-xs text-slate-200">Assumption: 200 hires/year (mid-sized enterprise)</p>
        </CardContent>
      </Card>

      <MetricsSection metrics={metrics} isLoading={isLoading} hasError={Boolean(error)} />
    </section>
  );
}
