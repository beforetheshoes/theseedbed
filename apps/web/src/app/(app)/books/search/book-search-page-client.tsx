"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Skeleton } from "primereact/skeleton";
import { ApiClientError, apiRequest } from "@/lib/api";
import { shouldUseUnoptimizedForUrl } from "@/lib/image-optimization";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useAppToast } from "@/components/toast-provider";

export type SearchItem = {
  source: "openlibrary" | "googlebooks";
  source_id: string;
  work_key: string;
  title: string;
  author_names: string[];
  first_publish_year: number | null;
  cover_url: string | null;
  edition_count: number | null;
  languages: string[];
  readable: boolean;
  attribution?: { text: string; url: string | null } | null;
};

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

type AddedStatus = "added" | "already_exists";
export type SortMode = "relevance" | "new" | "old";
export type LibraryStatus = "to_read" | "reading" | "completed";

export type BookSearchInitialFilters = {
  query: string;
  status: LibraryStatus;
  authorFilter: string;
  subjectFilter: string;
  languageFilter: string;
  yearFromFilter: string;
  yearToFilter: string;
  sort: SortMode;
};

export type BookSearchPageClientProps = {
  initialFilters: BookSearchInitialFilters;
  initialResults?: SearchItem[];
  initialNextPage?: number | null;
  initialError?: string;
};

const LIBRARY_UPDATED_EVENT = "chapterverse:library-updated";

const statusOptions: Array<{ label: string; value: LibraryStatus }> = [
  { label: "To read", value: "to_read" },
  { label: "Reading", value: "reading" },
  { label: "Completed", value: "completed" },
];

const sortOptions: Array<{ label: string; value: SortMode }> = [
  { label: "Relevance", value: "relevance" },
  { label: "Newest first", value: "new" },
  { label: "Oldest first", value: "old" },
];

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

function parsedYear(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function coverVisible(item: SearchItem, broken: Set<string>) {
  return Boolean(item.cover_url) && !broken.has(item.work_key);
}

export default function BookSearchPageClient({
  initialFilters,
  initialResults,
  initialNextPage = null,
  initialError = "",
}: BookSearchPageClientProps) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const toast = useAppToast();

  const [query, setQuery] = useState(initialFilters.query);
  const [status, setStatus] = useState<LibraryStatus>(initialFilters.status);
  const [authorFilter, setAuthorFilter] = useState(initialFilters.authorFilter);
  const [subjectFilter, setSubjectFilter] = useState(
    initialFilters.subjectFilter,
  );
  const [languageFilter, setLanguageFilter] = useState(
    initialFilters.languageFilter,
  );
  const [yearFromFilter, setYearFromFilter] = useState(
    initialFilters.yearFromFilter,
  );
  const [yearToFilter, setYearToFilter] = useState(initialFilters.yearToFilter);
  const [sort, setSort] = useState<SortMode>(initialFilters.sort);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [results, setResults] = useState<SearchItem[]>(
    () => initialResults ?? [],
  );
  const [nextPage, setNextPage] = useState<number | null>(initialNextPage);
  const [error, setError] = useState(initialError);
  const [hint, setHint] = useState(() => {
    if (initialError) return "";
    if (initialFilters.query.trim().length < 2) {
      return "Type at least 2 characters to search.";
    }
    if ((initialResults ?? []).length === 0) {
      return "No books found. Try another search.";
    }
    return "";
  });
  const [importingWorkKey, setImportingWorkKey] = useState<string | null>(null);
  const [activeQuery, setActiveQuery] = useState(() => {
    const trimmed = initialFilters.query.trim();
    return trimmed.length >= 2 ? trimmed : "";
  });
  const [brokenCoverKeys, setBrokenCoverKeys] = useState<Set<string>>(
    new Set(),
  );
  const [addedStatusByWorkKey, setAddedStatusByWorkKey] = useState<
    Record<string, AddedStatus>
  >({});

  const searchSeqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSearchRef = useRef<(input: string) => Promise<void>>(async () => {});
  const didHydrateInitialDataRef = useRef(
    Boolean(initialError || initialResults),
  );

  const fetchSearchPage = useCallback(
    async (page: number, queryValue = activeQuery): Promise<SearchResponse> => {
      const yearFrom = parsedYear(yearFromFilter);
      const yearTo = parsedYear(yearToFilter);

      return apiRequest<SearchResponse>(supabase, "/api/v1/books/search", {
        query: {
          query: queryValue,
          limit: 10,
          page,
          sort,
          ...(authorFilter.trim() ? { author: authorFilter.trim() } : {}),
          ...(subjectFilter.trim() ? { subject: subjectFilter.trim() } : {}),
          ...(languageFilter.trim() ? { language: languageFilter.trim() } : {}),
          ...(yearFrom !== null ? { first_publish_year_from: yearFrom } : {}),
          ...(yearTo !== null ? { first_publish_year_to: yearTo } : {}),
        },
      });
    },
    [
      activeQuery,
      authorFilter,
      languageFilter,
      sort,
      subjectFilter,
      supabase,
      yearFromFilter,
      yearToFilter,
    ],
  );

  const runSearch = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (trimmed.length < 2) {
        setResults([]);
        setNextPage(null);
        setActiveQuery("");
        setBrokenCoverKeys(new Set());
        setAddedStatusByWorkKey({});
        setError("");
        setHint("Type at least 2 characters to search.");
        return;
      }

      const currentSeq = ++searchSeqRef.current;
      setActiveQuery(trimmed);
      setLoading(true);
      setError("");
      setHint("");

      try {
        const payload = await fetchSearchPage(1, trimmed);
        if (currentSeq !== searchSeqRef.current) return;

        setResults(payload.items.map(normalizeSearchItem));
        setNextPage(payload.next_page);
        setBrokenCoverKeys(new Set());
        setAddedStatusByWorkKey({});

        if (!payload.items.length) {
          setHint("No books found. Try another search.");
        }
      } catch (err) {
        if (currentSeq !== searchSeqRef.current) return;
        setResults([]);
        setNextPage(null);
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Unable to search books right now.",
        );
      } finally {
        if (currentSeq === searchSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [fetchSearchPage],
  );

  useEffect(() => {
    runSearchRef.current = runSearch;
  }, [runSearch]);

  useEffect(() => {
    if (didHydrateInitialDataRef.current) {
      didHydrateInitialDataRef.current = false;
      return;
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      void runSearchRef.current(query);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query]);

  useEffect(() => {
    if (activeQuery) {
      void runSearch(activeQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authorFilter,
    subjectFilter,
    languageFilter,
    yearFromFilter,
    yearToFilter,
    sort,
  ]);

  const importAndAdd = async (book: SearchItem) => {
    const workKey = book.work_key;
    if (addedStatusByWorkKey[workKey] || importingWorkKey === workKey) {
      return;
    }

    setError("");
    setImportingWorkKey(workKey);

    try {
      const imported = await apiRequest<{ work: { id: string } }>(
        supabase,
        "/api/v1/books/import",
        {
          method: "POST",
          body:
            book.source === "googlebooks"
              ? { source: "googlebooks", source_id: book.source_id }
              : { source: "openlibrary", work_key: workKey },
        },
      );

      const libraryResult = await apiRequest<{ created: boolean }>(
        supabase,
        "/api/v1/library/items",
        {
          method: "POST",
          body: {
            work_id: imported.work.id,
            status,
          },
        },
      );

      setAddedStatusByWorkKey((current) => ({
        ...current,
        [workKey]: libraryResult.created ? "added" : "already_exists",
      }));
      window.dispatchEvent(new Event(LIBRARY_UPDATED_EVENT));
      const msg = libraryResult.created
        ? "Added to your library."
        : "Already in your library.";
      toast.show({ severity: "success", summary: msg, life: 3000 });
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to import this book right now.",
      );
    } finally {
      setImportingWorkKey(null);
    }
  };

  const loadMore = async () => {
    if (nextPage === null || loadingMore) return;

    const page = nextPage;
    const queryAtRequest = activeQuery;
    setLoadingMore(true);
    setError("");

    try {
      const payload = await fetchSearchPage(page);
      if (queryAtRequest !== activeQuery) {
        return;
      }

      setResults((current) => {
        const seen = new Set(current.map((item) => item.work_key));
        const nextItems = payload.items
          .map(normalizeSearchItem)
          .filter((item) => !seen.has(item.work_key));
        return [...current, ...nextItems];
      });
      setNextPage(payload.next_page);
    } catch (err) {
      if (queryAtRequest !== activeQuery) {
        return;
      }
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to load more books right now.",
      );
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Card className="rounded-xl" data-test="search-card">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xl font-semibold tracking-tight">
            Search and import books
          </p>
          <p className="text-sm text-[var(--p-text-muted-color)]">
            Import from Open Library, with optional Google Books results when
            enabled.
          </p>
        </div>
        <Link href="/library">
          <Button outlined severity="secondary">
            View library
          </Button>
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_220px]">
        <InputText
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full"
          placeholder="Search books"
          data-test="search-input"
        />
        <Dropdown
          data-test="status-select"
          value={status}
          options={statusOptions}
          optionLabel="label"
          optionValue="value"
          onChange={(event) => setStatus(event.value as LibraryStatus)}
        />
      </div>

      <div
        className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3"
        data-test="search-filters"
      >
        <InputText
          value={authorFilter}
          onChange={(event) => setAuthorFilter(event.target.value)}
          placeholder="Author filter"
          data-test="search-author"
        />
        <InputText
          value={subjectFilter}
          onChange={(event) => setSubjectFilter(event.target.value)}
          placeholder="Subject filter"
          data-test="search-subject"
        />
        <InputText
          value={languageFilter}
          onChange={(event) => setLanguageFilter(event.target.value)}
          placeholder="Language code (e.g. eng)"
          data-test="search-language"
        />
        <InputText
          value={yearFromFilter}
          onChange={(event) => setYearFromFilter(event.target.value)}
          placeholder="Year from"
          data-test="search-year-from"
        />
        <InputText
          value={yearToFilter}
          onChange={(event) => setYearToFilter(event.target.value)}
          placeholder="Year to"
          data-test="search-year-to"
        />
        <Dropdown
          data-test="search-sort"
          value={sort}
          options={sortOptions}
          optionLabel="label"
          optionValue="value"
          onChange={(event) => setSort(event.value as SortMode)}
        />
      </div>

      {hint ? (
        <p
          className="mt-4 text-sm text-[var(--p-text-muted-color)]"
          data-test="search-hint"
        >
          {hint}
        </p>
      ) : null}

      {error ? (
        <Message
          className="mt-3"
          severity="error"
          data-test="search-error"
          text={error}
        />
      ) : null}

      {loading ? (
        <div
          className="mt-4 grid gap-3 md:grid-cols-2"
          data-test="search-loading"
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index}>
              <Skeleton width="75%" height="1.25rem" />
              <Skeleton className="mt-2" width="50%" height="1rem" />
              <Skeleton className="mt-4" width="100%" height="2.25rem" />
            </Card>
          ))}
        </div>
      ) : null}

      {!loading && results.length ? (
        <div
          className="mt-4 grid gap-3 md:grid-cols-2"
          data-test="search-results"
        >
          {results.map((book, index) => {
            const addStatus = addedStatusByWorkKey[book.work_key];
            const buttonLabel =
              addStatus === "added"
                ? "Added"
                : addStatus === "already_exists"
                  ? "Already in library"
                  : "Import and add";

            return (
              <Card key={book.work_key}>
                <article className="flex gap-4">
                  <div
                    className="h-[120px] w-[80px] shrink-0 overflow-hidden rounded border border-[var(--p-content-border-color)] bg-[var(--surface-hover)]"
                    data-test="search-item-thumb"
                  >
                    {coverVisible(book, brokenCoverKeys) ? (
                      <Image
                        src={book.cover_url ?? ""}
                        alt=""
                        width={80}
                        height={120}
                        unoptimized={shouldUseUnoptimizedForUrl(
                          book.cover_url ?? "",
                        )}
                        className="h-full w-full object-cover"
                        data-test="search-item-cover"
                        onError={() => {
                          setBrokenCoverKeys((current) => {
                            const next = new Set(current);
                            next.add(book.work_key);
                            return next;
                          });
                        }}
                      />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center text-xs text-[var(--p-text-muted-color)]"
                        data-test="search-item-cover-placeholder"
                      >
                        No cover
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{book.title}</p>
                    <p className="truncate text-sm text-[var(--p-text-muted-color)]">
                      {book.author_names.join(", ") || "Unknown author"}
                    </p>
                    <p className="text-xs text-[var(--p-text-muted-color)]">
                      Source:{" "}
                      {book.source === "googlebooks"
                        ? "Google Books"
                        : "Open Library"}
                    </p>
                    {book.attribution?.text ? (
                      <p className="text-xs text-[var(--p-text-muted-color)]">
                        {book.attribution.text}
                      </p>
                    ) : null}
                    {book.first_publish_year ? (
                      <p className="text-xs text-[var(--p-text-muted-color)]">
                        First published: {book.first_publish_year}
                      </p>
                    ) : null}
                    <p className="text-xs text-[var(--p-text-muted-color)]">
                      {book.edition_count !== null
                        ? `Editions: ${book.edition_count}`
                        : ""}
                      {book.languages.length
                        ? `${book.edition_count !== null ? " | " : ""}Languages: ${book.languages.join(", ")}`
                        : ""}
                      {`${book.edition_count !== null || book.languages.length ? " | " : ""}${book.readable ? "Readable online" : "Metadata only"}`}
                    </p>

                    <Button
                      className="mt-3"
                      outlined
                      severity="secondary"
                      data-test={`search-add-${index}`}
                      disabled={
                        Boolean(addStatus) || importingWorkKey === book.work_key
                      }
                      loading={importingWorkKey === book.work_key}
                      onClick={() => {
                        void importAndAdd(book);
                      }}
                    >
                      {buttonLabel}
                    </Button>
                  </div>
                </article>
              </Card>
            );
          })}

          {nextPage !== null ? (
            <Button
              className="justify-self-start md:col-span-2"
              outlined
              severity="secondary"
              data-test="search-load-more"
              onClick={() => void loadMore()}
              loading={loadingMore}
              disabled={loadingMore}
            >
              Load more
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
