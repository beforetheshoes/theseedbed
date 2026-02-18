import { Skeleton } from "primereact/skeleton";

export default function PublicSegmentLoading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8"
      data-test="public-segment-loading"
    >
      <div className="rounded-xl border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-6">
        <Skeleton width="35%" height="1.75rem" />
        <Skeleton className="mt-4" width="80%" height="1rem" />
        <Skeleton className="mt-2" width="60%" height="1rem" />
      </div>
    </div>
  );
}
