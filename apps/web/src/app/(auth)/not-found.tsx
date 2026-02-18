import Link from "next/link";
import { EmptyState } from "@/components/empty-state";

export default function AuthSegmentNotFound() {
  return (
    <EmptyState
      data-test="auth-segment-not-found"
      icon="pi pi-lock"
      title="Auth page not found"
      body="This auth route is unavailable."
      action={
        <Link
          href="/login"
          className="inline-flex items-center rounded-md border border-[var(--p-content-border-color)] px-3 py-2 text-sm font-medium"
        >
          Back to login
        </Link>
      }
    />
  );
}
