import * as React from "react";

function cx(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(" ");
}

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("animate-pulse rounded-md bg-zinc-800/80", className)} {...props} />;
}

export { Skeleton };