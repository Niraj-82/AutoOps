import * as React from "react";

function cx(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(" ");
}

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  indicatorClassName?: string;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, indicatorClassName, ...props }, ref) => {
    const clamped = Math.max(0, Math.min(100, value));

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        className={cx("relative h-2 w-full overflow-hidden rounded-full bg-zinc-800", className)}
        {...props}
      >
        <div
          className={cx("h-full w-full origin-left rounded-full bg-blue-500 transition-transform", indicatorClassName)}
          style={{ transform: `translateX(-${100 - clamped}%)` }}
        />
      </div>
    );
  },
);

Progress.displayName = "Progress";

export { Progress };
