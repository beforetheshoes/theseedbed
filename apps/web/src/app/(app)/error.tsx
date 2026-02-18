"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "primereact/button";
import { Card } from "primereact/card";

export default function AppSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card data-test="app-segment-error">
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-1 text-sm text-[var(--p-text-muted-color)]">
            We could not load this page right now.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            label="Try again"
            onClick={reset}
            data-test="app-segment-error-retry"
          />
          <Link
            href="/library"
            className="inline-flex items-center rounded-md border border-[var(--p-content-border-color)] px-3 py-2 text-sm font-medium"
          >
            Go to library
          </Link>
        </div>
      </div>
    </Card>
  );
}
