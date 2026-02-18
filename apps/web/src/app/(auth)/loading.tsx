import { Skeleton } from "primereact/skeleton";

export default function AuthSegmentLoading() {
  return (
    <div
      className="flex min-h-screen flex-col"
      data-test="auth-segment-loading"
    >
      <main className="flex flex-1 items-center justify-center px-4 py-8 md:px-8 md:py-10">
        <div className="w-full max-w-lg rounded-xl border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-6">
          <Skeleton width="50%" height="1.5rem" />
          <Skeleton className="mt-3" width="100%" height="1rem" />
          <Skeleton className="mt-5" width="100%" height="2.5rem" />
          <Skeleton className="mt-3" width="100%" height="2.5rem" />
        </div>
      </main>
    </div>
  );
}
