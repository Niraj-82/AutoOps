"use client";

export default function AdvisoryBanner() {
  return (
    <div className="relative w-full border-b border-amber-300/30 bg-gradient-to-r from-amber-500/18 via-orange-500/14 to-amber-500/18 px-4 py-2.5 text-center text-sm font-semibold text-amber-100 backdrop-blur-md">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_50%,rgba(251,191,36,0.24),transparent_36%),radial-gradient(circle_at_88%_50%,rgba(249,115,22,0.16),transparent_34%)]" aria-hidden="true" />
      <span className="relative inline-flex items-center gap-2 font-sans uppercase tracking-wide">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300 anim-pulse-glow" aria-hidden="true" />
        Advisory Mode - Final Authority Rests With Human Operator
      </span>
    </div>
  );
}
