import Link from "next/link";
import { EmptyState } from "@/components/empty-state";

export default function PublicSegmentNotFound() {
  return (
    <EmptyState
      data-test="public-segment-not-found"
      icon="pi pi-exclamation-triangle"
      title="Public resource not found"
      body="The requested public page does not exist."
      action={
        <Link
          href="/"
          className="inline-flex items-center rounded-md border border-[var(--p-content-border-color)] px-3 py-2 text-sm font-medium"
        >
          Back home
        </Link>
      }
    />
  );
}
