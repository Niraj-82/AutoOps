"use client";

import useSWR from "swr";
import { getAuditTrail, getRunState } from "@/lib/api";
import type { AuditTrailResponse, RunState, RunStateResponse } from "@/types/autoops";

const POLL_INTERVAL_MS = 2000;

function shouldPoll(status: string | undefined): boolean {
  return status === "active" || status === "started";
}

export interface UseRunStateResult {
  runState: RunState | null;
  runStatus: string | null;
  auditData: AuditTrailResponse | null;
  isLoading: boolean;
  error: Error | null;
}

export function useRunState(runId: string | null): UseRunStateResult {
  const {
    data: runResponse,
    error: runError,
    isLoading: isRunLoading,
  } = useSWR<RunStateResponse>(
    runId ? ["autoops", "run", runId] : null,
    () => getRunState(runId!),
    {
      refreshInterval: (latestResponse) =>
        shouldPoll(latestResponse?.status) ? POLL_INTERVAL_MS : 0,
      revalidateOnFocus: false,
    },
  );

  const runStatus = runResponse?.status ?? null;

  const {
    data: auditResponse,
    error: auditError,
    isLoading: isAuditLoading,
  } = useSWR<AuditTrailResponse>(
    runId ? ["autoops", "audit", runId] : null,
    () => getAuditTrail(runId!),
    {
      refreshInterval: shouldPoll(runStatus ?? undefined) ? POLL_INTERVAL_MS : 0,
      revalidateOnFocus: false,
    },
  );

  return {
    runState: runResponse?.final_state ?? null,
    runStatus,
    auditData: auditResponse ?? null,
    isLoading: Boolean(runId) && (isRunLoading || isAuditLoading),
    error: (runError ?? auditError ?? null) as Error | null,
  };
}
