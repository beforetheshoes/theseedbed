import { Skeleton } from "primereact/skeleton";

export default function AppSegmentLoading() {
  return (
    <div className="min-h-screen" data-test="app-segment-loading">
      <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Skeleton width="14rem" height="1.25rem" />
        </div>
        <div className="grid gap-4">
          <Skeleton width="100%" height="10rem" />
          <Skeleton width="100%" height="10rem" />
        </div>
      </div>
    </div>
  );
}
