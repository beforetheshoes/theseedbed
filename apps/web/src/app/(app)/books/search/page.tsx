import { ApiClientError, apiRequestWithAccessToken } from "@/lib/api";
import { bootstrapAppRouteAccessToken } from "@/lib/app-route-server-bootstrap";
import BookSearchPageClient, {
  type BookSearchInitialFilters,
  type LibraryStatus,
  type SearchItem,
  type SortMode,
} from "./book-search-page-client";

export const dynamic = "force-dynamic";

type SearchResponse = {
  items: Array<
    Omit<SearchItem, "edition_count" | "languages" | "readable"> & {
      edition_count?: number | null;
      languages?: string[];
      readable?: boolean;
      source?: string;
      source_id?: string;
      attribution?: { text?: unknown; url?: unknown } | null;
    }
  >;
  next_page: number | null;
};

function pickSingle(
  value: string | string[] | undefined,
  fallback = "",
): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeStatus(value: string): LibraryStatus {
  return value === "reading" || value === "completed" ? value : "to_read";
}

function normalizeSort(value: string): SortMode {
  return value === "new" || value === "old" ? value : "relevance";
}

function normalizeSearchItem(
  item: SearchResponse["items"][number],
): SearchItem {
  return {
    ...item,
    source: item.source === "googlebooks" ? "googlebooks" : "openlibrary",
    source_id:
      typeof item.source_id === "string" && item.source_id.trim()
        ? item.source_id
        : item.source === "googlebooks"
          ? item.work_key.replace(/^googlebooks:/, "")
          : item.work_key,
    edition_count:
      typeof item.edition_count === "number" ? item.edition_count : null,
    languages: Array.isArray(item.languages)
      ? item.languages.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    readable: Boolean(item.readable),
    attribution:
      item.attribution &&
      typeof item.attribution.text === "string" &&
      item.attribution.text.trim()
        ? {
            text: item.attribution.text.trim(),
            url:
              typeof item.attribution.url === "string"
                ? item.attribution.url
                : null,
          }
        : null,
  };
}

export default async function BookSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const initialFilters: BookSearchInitialFilters = {
    query: pickSingle(resolved.query),
    status: normalizeStatus(pickSingle(resolved.status)),
    authorFilter: pickSingle(resolved.author),
    subjectFilter: pickSingle(resolved.subject),
    languageFilter: pickSingle(resolved.language),
    yearFromFilter: pickSingle(resolved.year_from),
    yearToFilter: pickSingle(resolved.year_to),
    sort: normalizeSort(pickSingle(resolved.sort)),
  };

  const trimmedQuery = initialFilters.query.trim();
  if (trimmedQuery.length < 2) {
    return <BookSearchPageClient initialFilters={initialFilters} />;
  }

  const auth = await bootstrapAppRouteAccessToken();
  if (auth.kind !== "authed") {
    return <BookSearchPageClient initialFilters={initialFilters} />;
  }

  let initialResults: SearchItem[] | undefined;
  let initialNextPage: number | null | undefined;
  let initialError: string | undefined;

  try {
    const payload = await apiRequestWithAccessToken<SearchResponse>(
      auth.accessToken,
      "/api/v1/books/search",
      {
        query: {
          query: trimmedQuery,
          limit: 10,
          page: 1,
          sort: initialFilters.sort,
          ...(initialFilters.authorFilter.trim()
            ? { author: initialFilters.authorFilter.trim() }
            : {}),
          ...(initialFilters.subjectFilter.trim()
            ? { subject: initialFilters.subjectFilter.trim() }
            : {}),
          ...(initialFilters.languageFilter.trim()
            ? { language: initialFilters.languageFilter.trim() }
            : {}),
          ...(initialFilters.yearFromFilter.trim()
            ? { first_publish_year_from: initialFilters.yearFromFilter.trim() }
            : {}),
          ...(initialFilters.yearToFilter.trim()
            ? { first_publish_year_to: initialFilters.yearToFilter.trim() }
            : {}),
        },
      },
    );
    initialResults = payload.items.map(normalizeSearchItem);
    initialNextPage = payload.next_page;
  } catch (error) {
    initialError =
      error instanceof ApiClientError
        ? error.message
        : "Unable to search books right now.";
  }

  return (
    <BookSearchPageClient
      initialFilters={initialFilters}
      initialResults={initialResults}
      initialNextPage={initialNextPage}
      initialError={initialError}
    />
  );
}
