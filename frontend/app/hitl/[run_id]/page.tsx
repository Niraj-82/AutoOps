import HITLApproval from "@/components/hitl/HITLApproval";

interface HITLRunPageProps {
  params: {
    run_id: string;
  };
}

export default function HITLRunPage({ params }: HITLRunPageProps) {
  const runId = decodeURIComponent(params.run_id);

  return (
    <main className="min-h-[calc(100vh-2.8rem)] p-4 text-zinc-100 md:p-5">
      <div className="mx-auto mb-4 max-w-5xl rounded-2xl border border-indigo-300/35 bg-gradient-to-r from-cyan-500/10 via-indigo-500/12 to-violet-500/14 p-4 shadow-glow backdrop-blur-sm">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Human In The Loop</p>
        <h1 className="mt-1 text-2xl font-semibold md:text-3xl">
          <span className="gradient-text">Escalation Review Workspace</span>
        </h1>
      </div>

      <div className="mx-auto max-w-5xl rounded-2xl border border-slate-500/30 bg-slate-900/45 p-4 backdrop-blur-sm">
        <HITLApproval runId={runId} />
      </div>
    </main>
  );
}
