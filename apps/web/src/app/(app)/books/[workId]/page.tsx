import { notFound } from "next/navigation";
import {
  ApiClientError,
  apiRequestWithAccessToken,
  getAccessToken,
} from "@/lib/api";
import { createServerClient } from "@/lib/supabase/server";
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

  const supabase = await createServerClient();
  let accessToken: string;
  try {
    accessToken = await getAccessToken(supabase);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      return <BookDetailPageClient initialWorkId={workId} />;
    }
    throw error;
  }

  try {
    await apiRequestWithAccessToken<WorkLookup>(
      accessToken,
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
