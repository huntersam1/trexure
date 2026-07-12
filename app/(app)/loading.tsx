import type { JSX } from "react";

// Segment loading state for the authed app: a lightweight skeleton of the
// common page shape (heading row, KPI band, table card) shown inside the shell
// while force-dynamic pages render.
export default function AppSegmentLoading(): JSX.Element {
  const shimmer = "bg-surface-container-high animate-pulse motion-reduce:animate-none rounded-lg";
  return (
    <div aria-busy="true" aria-label="Loading page" className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className={`${shimmer} h-8 w-56`} />
        <div className={`${shimmer} h-10 w-36`} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${shimmer} h-24`} />
        <div className={`${shimmer} h-24`} />
        <div className={`${shimmer} h-24`} />
      </div>
      <div className="bg-surface border border-outline-variant rounded-xl shadow-xl shadow-black/5 p-6 flex flex-col gap-3">
        <div className={`${shimmer} h-4 w-1/3`} />
        <div className={`${shimmer} h-4 w-full`} />
        <div className={`${shimmer} h-4 w-full`} />
        <div className={`${shimmer} h-4 w-2/3`} />
      </div>
    </div>
  );
}
