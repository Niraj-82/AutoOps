"use client";

import type { ReactNode } from "react";
import { Component } from "react";

interface DAGErrorBoundaryProps {
  children: ReactNode;
}

interface DAGErrorBoundaryState {
  hasError: boolean;
}

export default class DAGErrorBoundary extends Component<DAGErrorBoundaryProps, DAGErrorBoundaryState> {
  public state: DAGErrorBoundaryState = {
    hasError: false,
  };

  public static getDerivedStateFromError(): DAGErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error): void {
    // Keep the rest of the dashboard interactive if React Flow throws.
    console.error("AutoOps DAG render error", error);
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[60vh] items-center justify-center rounded-xl border border-rose-400/35 bg-gradient-to-br from-rose-500/12 via-rose-600/10 to-slate-950/30 p-6 text-center backdrop-blur">
          <div className="max-w-md space-y-2 rounded-xl border border-rose-400/30 bg-slate-950/60 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.15em] text-rose-200">DAG Unavailable</p>
            <p className="text-sm text-rose-100/90">The workflow graph hit a render error, but telemetry panels and HITL controls are still available.</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
