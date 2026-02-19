import { ApiClientError, apiRequestWithAccessToken } from "@/lib/api";
import { bootstrapAppRouteAccessToken } from "@/lib/app-route-server-bootstrap";
import LibraryPageClient, {
  type LibraryItem,
  type LibraryPagination,
} from "./library-page-client";

export const dynamic = "force-dynamic";

type LibraryResponse = {
  items: LibraryItem[];
  pagination?: LibraryPagination;
  next_cursor?: string | null;
};

export default async function LibraryPage() {
  const auth = await bootstrapAppRouteAccessToken();

  if (auth.kind !== "authed") {
    return <LibraryPageClient initialAuthed={false} />;
  }

  let initialData:
    | {
        items: LibraryItem[];
        pagination: LibraryPagination;
      }
    | undefined;
  let initialError: string | undefined;

  try {
    const payload = await apiRequestWithAccessToken<LibraryResponse>(
      auth.accessToken,
      "/api/v1/library/items",
      {
        query: {
          page: 1,
          page_size: 25,
          sort: "newest",
        },
      },
    );

    const pagination: LibraryPagination = payload.pagination ?? {
      page: 1,
      page_size: 25,
      total_count: payload.items.length,
      total_pages: payload.items.length > 0 ? 1 : 0,
      from: payload.items.length > 0 ? 1 : 0,
      to: payload.items.length,
      has_prev: false,
      has_next: Boolean(payload.next_cursor),
    };

    initialData = {
      items: payload.items,
      pagination,
    };
  } catch (error) {
    initialError =
      error instanceof ApiClientError
        ? error.message
        : "Unable to load library items right now.";
  }

  return (
    <LibraryPageClient
      initialAuthed
      initialData={initialData}
      initialError={initialError}
    />
  );
}
