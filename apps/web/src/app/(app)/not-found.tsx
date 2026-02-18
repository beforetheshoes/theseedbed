import Link from "next/link";
import { EmptyState } from "@/components/empty-state";

export default function AppSegmentNotFound() {
  return (
    <EmptyState
      data-test="app-segment-not-found"
      icon="pi pi-search"
      title="This page could not be found"
      body="The resource may have been moved or removed."
      action={
        <Link
          href="/library"
          className="inline-flex items-center rounded-md border border-[var(--p-content-border-color)] px-3 py-2 text-sm font-medium"
        >
          Back to library
        </Link>
      }
    />
  );
}
