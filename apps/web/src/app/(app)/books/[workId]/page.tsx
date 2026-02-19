import { notFound } from "next/navigation";
import { ApiClientError, apiRequestWithAccessToken } from "@/lib/api";
import { bootstrapAppRouteAccessToken } from "@/lib/app-route-server-bootstrap";
import BookDetailPageClient from "./book-detail-page-client";

export const dynamic = "force-dynamic";

type WorkLookup = {
  id: string;
};

function normalizeRouteParam(value: string): string {
  return value.trim();
}

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const { workId: rawWorkId } = await params;
  const workId = normalizeRouteParam(rawWorkId);

  if (!workId) {
    notFound();
  }

  const auth = await bootstrapAppRouteAccessToken();
  if (auth.kind !== "authed") {
    return <BookDetailPageClient initialWorkId={workId} />;
  }

  try {
    await apiRequestWithAccessToken<WorkLookup>(
      auth.accessToken,
      `/api/v1/works/${workId}`,
    );
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return <BookDetailPageClient initialWorkId={workId} />;
}
