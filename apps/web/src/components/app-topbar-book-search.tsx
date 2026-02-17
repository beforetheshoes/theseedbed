"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { SelectButton } from "primereact/selectbutton";
import { Skeleton } from "primereact/skeleton";
import { ApiClientError, apiRequest } from "@/lib/api";
import { createBrowserClient } from "@/lib/supabase/browser";

type SearchScope = "my" | "global" | "both";

type LibrarySearchItem = {
  kind: "library";
  work_id: string;
  work_title: string;
  author_names: string[];
  cover_url: string | null;
  openlibrary_work_key: string | null;
};

type ExternalSearchItem = {
  kind: "openlibrary" | "googlebooks";
  source: "openlibrary" | "googlebooks";
  source_id: string;
  work_key: string;
  title: string;
  author_names: string[];
  cover_url: string | null;
  attribution?: { text: string; url: string | null } | null;
};

type SearchOption = LibrarySearchItem | ExternalSearchItem;

const LIBRARY_UPDATED_EVENT = "chapterverse:library-updated";

function itemKey(item: SearchOption): string {
  return item.kind === "library"
    ? `lib:${item.work_id}`
    : `ext:${item.work_key}`;
}

function displayTitle(item: SearchOption): string {
  return item.kind === "library" ? item.work_title : item.title;
}

function displayAuthors(item: SearchOption): string {
  return (item.author_names ?? []).join(", ") || "Unknown author";
}

export function AppTopBarBookSearch() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("both");
  const [languageFilter, setLanguageFilter] = useState("");
  const [yearFromFilter, setYearFromFilter] = useState("");
  const [yearToFilter, setYearToFilter] = useState("");

  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [libraryItems, setLibraryItems] = useState<LibrarySearchItem[]>([]);
  const [externalItems, setExternalItems] = useState<ExternalSearchItem[]>([]);
  const [addingKeys, setAddingKeys] = useState<Set<string>>(new Set());
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());

  const requestSeqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scopeOptions = useMemo(
    () => [
      { label: "My Library", value: "my" },
      { label: "Global", value: "global" },
      { label: "Both", value: "both" },
    ],
    [],
  );

  const visibleItems = useMemo(() => {
    const items: SearchOption[] = [];
    if (scope === "my" || scope === "both") {
      items.push(...libraryItems);
    }
    if (scope === "global" || scope === "both") {
      items.push(...externalItems);
    }
    return items.slice(0, 9);
  }, [externalItems, libraryItems, scope]);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const resetResults = () => {
    setLibraryItems([]);
    setExternalItems([]);
  };

  const clear = () => {
    setQuery("");
    setErrorMessage("");
    setLoading(false);
    resetResults();
    clearTimer();
    setDesktopOpen(false);
  };

  const runSearch = useCallback(
    async (trimmed: string) => {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      setErrorMessage("");
      if (!mobileOpen) {
        setDesktopOpen(true);
      }

      try {
        let nextLibrary: LibrarySearchItem[] = [];
        let nextExternal: ExternalSearchItem[] = [];

        if (scope === "my" || scope === "both") {
          const payload = await apiRequest<{
            items: Omit<LibrarySearchItem, "kind">[];
          }>(supabase, "/api/v1/library/search", {
            query: { query: trimmed, limit: 10 },
          });
          if (seq !== requestSeqRef.current) return;
          nextLibrary = payload.items.map((item) => ({
            kind: "library",
            ...item,
          }));
        }

        const libraryKeys = new Set(
          nextLibrary
            .map((item) => item.openlibrary_work_key)
            .filter((item): item is string => Boolean(item)),
        );

        if (scope === "global" || scope === "both") {
          const params: Record<string, string | number> = {
            query: trimmed,
            limit: 10,
            page: 1,
          };
          const language = languageFilter.trim();
          const from = Number.parseInt(yearFromFilter.trim(), 10);
          const to = Number.parseInt(yearToFilter.trim(), 10);
          if (language) params.language = language;
          if (!Number.isNaN(from)) params.first_publish_year_from = from;
          if (!Number.isNaN(to)) params.first_publish_year_to = to;

          const payload = await apiRequest<{
            items: Array<{
              source?: string;
              source_id?: string;
              work_key: string;
              title: string;
              author_names?: string[];
              cover_url?: string | null;
              attribution?: { text?: unknown; url?: unknown } | null;
            }>;
          }>(supabase, "/api/v1/books/search", { query: params });
          if (seq !== requestSeqRef.current) return;

          nextExternal = payload.items
            .map((item) => {
              const source =
                item.source === "googlebooks" ? "googlebooks" : "openlibrary";
              const sourceId =
                typeof item.source_id === "string" &&
                item.source_id.trim().length > 0
                  ? item.source_id
                  : source === "openlibrary"
                    ? item.work_key
                    : item.work_key.replace(/^googlebooks:/, "");

              return {
                kind: source,
                source,
                source_id: sourceId,
                work_key:
                  source === "openlibrary"
                    ? item.work_key
                    : item.work_key || `googlebooks:${sourceId}`,
                title: item.title,
                author_names: item.author_names ?? [],
                cover_url: item.cover_url ?? null,
                attribution:
                  source === "googlebooks" &&
                  item.attribution &&
                  typeof item.attribution.text === "string"
                    ? {
                        text: item.attribution.text,
                        url:
                          typeof item.attribution.url === "string"
                            ? item.attribution.url
                            : null,
                      }
                    : null,
              } satisfies ExternalSearchItem;
            })
            .filter((item) =>
              scope === "both" ? !libraryKeys.has(item.work_key) : true,
            );
        }

        setLibraryItems(nextLibrary);
        setExternalItems(nextExternal);
      } catch (error) {
        if (seq !== requestSeqRef.current) return;
        resetResults();
        setErrorMessage(
          error instanceof ApiClientError
            ? error.message
            : "Unable to search right now.",
        );
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [languageFilter, mobileOpen, scope, supabase, yearFromFilter, yearToFilter],
  );

  const scheduleSearch = useCallback(
    (immediate: boolean) => {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        clearTimer();
        resetResults();
        setLoading(false);
        setErrorMessage("");
        setDesktopOpen(false);
        return;
      }

      clearTimer();
      if (immediate) {
        void runSearch(trimmed);
        return;
      }

      timerRef.current = setTimeout(() => {
        void runSearch(trimmed);
      }, 300);
    },
    [query, runSearch],
  );

  useEffect(() => {
    scheduleSearch(false);
    return () => clearTimer();
  }, [scheduleSearch]);

  useEffect(() => {
    scheduleSearch(true);
  }, [scope, languageFilter, yearFromFilter, yearToFilter, scheduleSearch]);

  const addOpenLibraryItem = async (item: ExternalSearchItem) => {
    if (addingKeys.has(item.work_key) || addedKeys.has(item.work_key)) {
      return;
    }

    setAddingKeys((current) => {
      const next = new Set(current);
      next.add(item.work_key);
      return next;
    });

    try {
      const imported = await apiRequest<{ work: { id: string } }>(
        supabase,
        "/api/v1/books/import",
        {
          method: "POST",
          body:
            item.source === "googlebooks"
              ? { source: "googlebooks", source_id: item.source_id }
              : { source: "openlibrary", work_key: item.work_key },
        },
      );

      await apiRequest<{ created: boolean }>(
        supabase,
        "/api/v1/library/items",
        {
          method: "POST",
          body: { work_id: imported.work.id, status: "to_read" },
        },
      );

      setAddedKeys((current) => {
        const next = new Set(current);
        next.add(item.work_key);
        return next;
      });
      window.dispatchEvent(new Event(LIBRARY_UPDATED_EVENT));
    } catch {
      setErrorMessage("Unable to add this book right now.");
    } finally {
      setAddingKeys((current) => {
        const next = new Set(current);
        next.delete(item.work_key);
        return next;
      });
    }
  };

  const openLibraryItem = (item: LibrarySearchItem) => {
    clear();
    setMobileOpen(false);
    router.push(`/books/${item.work_id}`);
  };

  const isDisabled = (item: SearchOption) =>
    item.kind !== "library" &&
    (addingKeys.has(item.work_key) || addedKeys.has(item.work_key));

  const renderResults = (mobile: boolean) => {
    if (errorMessage) {
      return (
        <Message
          severity="error"
          className="w-full"
          text={errorMessage}
          data-test={
            mobile ? "topbar-search-error-mobile" : "topbar-search-error"
          }
        />
      );
    }

    if (loading) {
      return (
        <div
          className="grid gap-2"
          data-test={
            mobile ? "topbar-search-loading-mobile" : "topbar-search-loading"
          }
        >
          {Array.from({ length: mobile ? 4 : 3 }).map((_, index) => (
            <Card key={index}>
              <div className="flex items-start gap-3">
                <Skeleton width="44px" height="64px" />
                <div className="flex-1">
                  <Skeleton width="70%" height="1rem" className="mb-2" />
                  <Skeleton width="45%" height="0.875rem" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      );
    }

    if (!visibleItems.length) {
      return (
        <Message
          severity="info"
          className="w-full"
          text={
            query.trim().length < 2
              ? "Type at least 2 characters to search."
              : "No books found. Try another search."
          }
          data-test={
            mobile ? "topbar-search-hint-mobile" : "topbar-search-hint"
          }
        />
      );
    }

    return (
      <div
        className={`grid gap-3 ${
          mobile ? "grid-cols-2" : "grid-cols-3 items-start"
        }`}
        data-test={
          mobile ? "topbar-search-results-mobile" : "topbar-search-results"
        }
      >
        {visibleItems.map((item) => (
          <Card key={itemKey(item)} className="min-w-0">
            <Button
              text
              className="flex w-full min-w-0 items-start gap-3 text-left disabled:opacity-60"
              disabled={isDisabled(item)}
              data-test={
                mobile
                  ? item.kind === "library"
                    ? `topbar-search-open-mobile-${item.work_id}`
                    : `topbar-search-add-mobile-${item.work_key}`
                  : item.kind === "library"
                    ? `topbar-search-open-${item.work_id}`
                    : `topbar-search-add-${item.work_key}`
              }
              onClick={() => {
                if (item.kind === "library") {
                  openLibraryItem(item);
                  return;
                }
                void addOpenLibraryItem(item);
              }}
            >
              <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-[var(--p-surface-100)]">
                {item.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.cover_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-[var(--p-text-muted-color)]">
                    No cover
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium">
                  {displayTitle(item)}
                </p>
                <p className="line-clamp-2 text-xs text-[var(--p-text-muted-color)]">
                  {displayAuthors(item)}
                </p>
                {item.kind === "googlebooks" && item.attribution?.text ? (
                  <p className="mt-1 text-[10px] text-[var(--p-text-muted-color)]">
                    {item.attribution.text}
                  </p>
                ) : null}
              </div>
            </Button>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <>
      <div
        className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:block"
        data-test="topbar-book-search-desktop"
      >
        <div className="flex w-[min(760px,92vw)] items-center gap-2 lg:w-[min(760px,52vw)]">
          <div className="flex flex-1">
            <div className="flex w-full items-center gap-1">
              <InputText
                value={query}
                onFocus={() => {
                  if (query.trim().length >= 2) {
                    setDesktopOpen(true);
                  }
                }}
                onBlur={(event) => {
                  // Close dropdown when focus leaves the entire search area.
                  const related = event.relatedTarget as Node | null;
                  const container = event.currentTarget.closest(
                    "[data-test='topbar-book-search-desktop']",
                  );
                  if (container && related && container.contains(related))
                    return;
                  // Delay slightly so click events on results fire first.
                  setTimeout(() => setDesktopOpen(false), 200);
                }}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a book"
                className="w-full"
                data-test="topbar-search-input"
              />
              {query.trim() ? (
                <Button
                  icon="pi pi-times"
                  text
                  severity="secondary"
                  size="small"
                  aria-label="Clear search"
                  data-test="topbar-search-clear"
                  onClick={clear}
                />
              ) : null}
            </div>
          </div>
          <SelectButton
            value={scope}
            options={scopeOptions}
            optionLabel="label"
            optionValue="value"
            data-test="topbar-search-scope"
            onChange={(event) => setScope(event.value as SearchScope)}
          />
        </div>

        {desktopOpen ? (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-overlay)] p-3 shadow-lg"
            data-test="topbar-search-popover"
          >
            <div className="mb-2 grid grid-cols-3 gap-2">
              <InputText
                value={languageFilter}
                onChange={(event) => setLanguageFilter(event.target.value)}
                placeholder="Lang (eng)"
                data-test="topbar-search-language"
              />
              <InputText
                value={yearFromFilter}
                onChange={(event) => setYearFromFilter(event.target.value)}
                placeholder="Year from"
                data-test="topbar-search-year-from"
              />
              <InputText
                value={yearToFilter}
                onChange={(event) => setYearToFilter(event.target.value)}
                placeholder="Year to"
                data-test="topbar-search-year-to"
              />
            </div>
            {renderResults(false)}
          </div>
        ) : null}
      </div>

      <Button
        text
        severity="secondary"
        className="lg:!hidden"
        icon="pi pi-search"
        aria-label="Search"
        data-test="topbar-search-mobile-open"
        onClick={() => setMobileOpen(true)}
      >
        Search
      </Button>

      {mobileOpen ? (
        <Dialog
          visible={mobileOpen}
          onHide={() => setMobileOpen(false)}
          header="Search"
          className="w-full max-w-xl"
          modal
          data-test="topbar-search-mobile-dialog"
        >
          <div className="w-full">
            <div className="mb-3">
              <div className="flex items-center gap-1">
                <InputText
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a book"
                  className="w-full"
                  data-test="topbar-search-input-mobile"
                />
                {query.trim() ? (
                  <Button
                    icon="pi pi-times"
                    text
                    severity="secondary"
                    size="small"
                    aria-label="Clear search"
                    data-test="topbar-search-clear-mobile"
                    onClick={clear}
                  />
                ) : null}
              </div>
            </div>

            <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SelectButton
                value={scope}
                options={scopeOptions}
                optionLabel="label"
                optionValue="value"
                data-test="topbar-search-scope-mobile"
                onChange={(event) => setScope(event.value as SearchScope)}
              />
              <InputText
                value={languageFilter}
                onChange={(event) => setLanguageFilter(event.target.value)}
                placeholder="Lang"
                data-test="topbar-search-language-mobile"
              />
              <InputText
                value={yearFromFilter}
                onChange={(event) => setYearFromFilter(event.target.value)}
                placeholder="Year from"
                data-test="topbar-search-year-from-mobile"
              />
              <InputText
                value={yearToFilter}
                onChange={(event) => setYearToFilter(event.target.value)}
                placeholder="Year to"
                data-test="topbar-search-year-to-mobile"
              />
            </div>

            {renderResults(true)}

            <div className="mt-3 flex justify-end">
              <Button
                outlined
                data-test="topbar-search-mobile-close"
                onClick={() => setMobileOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
