"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Card } from "primereact/card";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { DataView } from "primereact/dataview";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { Inplace, InplaceContent, InplaceDisplay } from "primereact/inplace";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { MultiSelect } from "primereact/multiselect";
import { Paginator } from "primereact/paginator";
import { SelectButton } from "primereact/selectbutton";
import { Skeleton } from "primereact/skeleton";
import { Tag } from "primereact/tag";
import { ApiClientError, apiRequest } from "@/lib/api";
import { renderDescriptionHtml } from "@/lib/description";
import { createBrowserClient } from "@/lib/supabase/browser";
import { CoverPlaceholder } from "@/components/cover-placeholder";
import { EmptyState } from "@/components/empty-state";
import { useAppToast } from "@/components/toast-provider";

/* ─── Types ─── */

type LibraryItemStatus = "to_read" | "reading" | "completed" | "abandoned";
type LibraryItemVisibility = "private" | "public";
type SortMode =
  | "newest"
  | "oldest"
  | "title_asc"
  | "title_desc"
  | "author_asc"
  | "author_desc"
  | "status_asc"
  | "status_desc"
  | "rating_asc"
  | "rating_desc";
type LibraryViewMode = "list" | "grid" | "table";
type TableColumnKey =
  | "cover"
  | "title"
  | "author"
  | "status"
  | "description"
  | "rating"
  | "tags"
  | "recommendations"
  | "last_read"
  | "added";

type LibraryItem = {
  id: string;
  work_id: string;
  work_title: string;
  work_description?: string | null;
  friend_recommendations_count?: number | null;
  author_names?: string[];
  cover_url?: string | null;
  status: LibraryItemStatus;
  visibility: LibraryItemVisibility;
  rating?: number | null;
  tags?: string[];
  last_read_at?: string | null;
  created_at?: string;
};

type LibraryPagination = {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
  from: number;
  to: number;
  has_prev: boolean;
  has_next: boolean;
};

type MergeFieldKey =
  | "status"
  | "visibility"
  | "rating"
  | "preferred_edition_id"
  | "tags";
type MergeDependencies = {
  read_cycles: number;
  progress_logs: number;
  notes: number;
  highlights: number;
  reviews: number;
};
type MergePreviewPayload = {
  selection: {
    target_item_id: string;
    source_item_ids: string[];
    selected_item_ids: string[];
  };
  fields: {
    candidates: Record<MergeFieldKey, Record<string, unknown>>;
    resolution: Record<MergeFieldKey, string>;
    defaults: Record<MergeFieldKey, string>;
  };
  dependencies?: {
    by_item: Record<string, MergeDependencies>;
    totals_for_sources: MergeDependencies;
  };
  warnings: string[];
};

type ReadDateEntry = {
  key: string;
  startedAt: Date | null;
  endedAt: Date | null;
};

/* ─── Constants ─── */

const LIBRARY_UPDATED_EVENT = "chapterverse:library-updated";
const VIEW_MODE_STORAGE_KEY = "seedbed.library.viewMode";
const TABLE_COLUMNS_STORAGE_KEY = "seedbed.library.tableColumns";
const EMPTY_DESCRIPTION_LABEL = "No description available.";

const ALL_TABLE_COLUMNS: readonly TableColumnKey[] = [
  "cover",
  "title",
  "author",
  "status",
  "description",
  "rating",
  "tags",
  "recommendations",
  "last_read",
  "added",
];
const DEFAULT_TABLE_COLUMNS: TableColumnKey[] = [
  "cover",
  "title",
  "author",
  "status",
  "description",
  "rating",
  "tags",
  "added",
];

const STATUS_OPTIONS = [
  { label: "To read", value: "to_read" },
  { label: "Reading", value: "reading" },
  { label: "Completed", value: "completed" },
  { label: "Abandoned", value: "abandoned" },
];
const VISIBILITY_OPTIONS = [
  { label: "Private", value: "private" },
  { label: "Public", value: "public" },
];
const VIEW_OPTIONS = [
  { label: "List", value: "list" },
  { label: "Grid", value: "grid" },
  { label: "Table", value: "table" },
];
const SORT_OPTIONS = [
  { label: "Newest first", value: "newest" },
  { label: "Oldest first", value: "oldest" },
  { label: "Title A-Z", value: "title_asc" },
  { label: "Title Z-A", value: "title_desc" },
  { label: "Author A-Z", value: "author_asc" },
  { label: "Author Z-A", value: "author_desc" },
  { label: "Status A-Z", value: "status_asc" },
  { label: "Status Z-A", value: "status_desc" },
  { label: "Rating low-high", value: "rating_asc" },
  { label: "Rating high-low", value: "rating_desc" },
];
const TABLE_COLUMN_OPTIONS = [
  { label: "Cover", value: "cover" },
  { label: "Title", value: "title" },
  { label: "Author", value: "author" },
  { label: "Status", value: "status" },
  { label: "Description", value: "description" },
  { label: "Rating", value: "rating" },
  { label: "Tags", value: "tags" },
  { label: "Recommendations", value: "recommendations" },
  { label: "Last read", value: "last_read" },
  { label: "Added", value: "added" },
] satisfies ReadonlyArray<{ label: string; value: TableColumnKey }>;

/* ─── Helpers ─── */

const statusLabel = (status: LibraryItemStatus) =>
  status === "to_read"
    ? "To read"
    : status === "reading"
      ? "Reading"
      : status === "completed"
        ? "Completed"
        : "Abandoned";

const visibilityLabel = (visibility: LibraryItemVisibility) =>
  visibility === "public" ? "Public" : "Private";

const tagPtBase = {
  root: {
    className:
      "border px-2.5 py-1 font-semibold leading-none shadow-none transition-colors duration-150",
  },
  icon: { className: "text-[0.72rem]" },
  label: { className: "leading-none" },
} as const;

// Inline styles are needed because PrimeReact 10's .p-tag is non-layered CSS
// which always beats Tailwind v4's @layer utilities regardless of specificity.
type TagColorSet = {
  bg: string;
  color: string;
  borderColor: string;
  darkBg: string;
  darkColor: string;
  darkBorderColor: string;
};

const STATUS_COLORS: Record<LibraryItemStatus, TagColorSet> = {
  reading: {
    bg: "#eff6ff",
    color: "#1d4ed8",
    borderColor: "#93c5fd",
    darkBg: "rgba(23, 37, 84, 0.5)",
    darkColor: "#bfdbfe",
    darkBorderColor: "#1e3a5f",
  },
  completed: {
    bg: "#ecfdf5",
    color: "#047857",
    borderColor: "#6ee7b7",
    darkBg: "rgba(6, 78, 59, 0.5)",
    darkColor: "#a7f3d0",
    darkBorderColor: "#065f46",
  },
  abandoned: {
    bg: "#fffbeb",
    color: "#b45309",
    borderColor: "#fcd34d",
    darkBg: "rgba(69, 26, 3, 0.55)",
    darkColor: "#fde68a",
    darkBorderColor: "#78350f",
  },
  to_read: {
    bg: "#f0fdfa",
    color: "#0f766e",
    borderColor: "#5eead4",
    darkBg: "rgba(4, 47, 46, 0.55)",
    darkColor: "#99f6e4",
    darkBorderColor: "#115e59",
  },
};

const VISIBILITY_COLORS: Record<LibraryItemVisibility, TagColorSet & { borderStyle: string }> = {
  public: {
    bg: "#f0f9ff",
    color: "#0369a1",
    borderColor: "#7dd3fc",
    darkBg: "rgba(12, 74, 110, 0.5)",
    darkColor: "#bae6fd",
    darkBorderColor: "#075985",
    borderStyle: "solid",
  },
  private: {
    bg: "#f5f3ff",
    color: "#6d28d9",
    borderColor: "#c4b5fd",
    darkBg: "rgba(46, 16, 101, 0.5)",
    darkColor: "#ddd6fe",
    darkBorderColor: "#5b21b6",
    borderStyle: "dashed",
  },
};

function resolveTagColors(cs: TagColorSet): React.CSSProperties {
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");
  return {
    background: isDark ? cs.darkBg : cs.bg,
    color: isDark ? cs.darkColor : cs.color,
    borderColor: isDark ? cs.darkBorderColor : cs.borderColor,
  };
}

const statusTagPt = (value: LibraryItemStatus) => ({
  ...tagPtBase,
  root: {
    className: tagPtBase.root.className,
    style: resolveTagColors(STATUS_COLORS[value]),
  },
});

const visibilityTagPt = (value: LibraryItemVisibility) => {
  const cs = VISIBILITY_COLORS[value];
  return {
    ...tagPtBase,
    root: {
      className: tagPtBase.root.className,
      style: {
        ...resolveTagColors(cs),
        borderWidth: "2px",
        borderStyle: cs.borderStyle,
      },
    },
  };
};

const visibilityTagIcon = (value: LibraryItemVisibility) =>
  value === "public" ? "pi pi-eye" : "pi pi-lock";

const ratingValue = (value?: number | null) => {
  if (typeof value !== "number") return 0;
  return Math.max(0, Math.min(5, value / 2));
};

function HalfStarRating({
  value,
  className,
  onChange,
}: {
  value: number;
  className?: string;
  onChange?: (starValue: number) => void;
}) {
  const interactive = !!onChange;
  return (
    <span
      className={`inline-flex gap-0.5 ${interactive ? "cursor-pointer" : ""} ${className ?? ""}`}
      role={interactive ? "slider" : undefined}
      aria-valuenow={interactive ? Math.round(value * 2) : undefined}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? 10 : undefined}
      aria-label={interactive ? "Rating" : undefined}
    >
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span
            key={i}
            className={`relative inline-block text-sm leading-none ${interactive ? "transition-transform hover:scale-110" : ""}`}
            onClick={interactive ? (e: React.MouseEvent<HTMLSpanElement>) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const isLeftHalf = (e.clientX - rect.left) < rect.width / 2;
              const newValue = isLeftHalf ? i + 0.5 : i + 1;
              onChange(newValue === value ? 0 : newValue);
            } : undefined}
          >
            <i className="pi pi-star" style={{ color: "var(--p-text-muted-color)", opacity: 0.3 }} />
            {fill > 0 && (
              <i
                className="pi pi-star-fill absolute inset-0"
                style={{
                  color: "var(--p-primary-color)",
                  clipPath: `inset(0 ${(1 - fill) * 100}% 0 0)`,
                }}
              />
            )}
          </span>
        );
      })}
    </span>
  );
}

const visibleTags = (tags?: string[], max = 2) => (tags || []).slice(0, max);
const remainingTagCount = (tags?: string[], max = 2) =>
  Math.max(0, (tags || []).length - max);

const recommendationLabel = (value?: number | null) => {
  if (typeof value !== "number") return "No recs";
  if (value <= 0) return "0 recs";
  if (value === 1) return "1 rec";
  return `${value} recs`;
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
};

const descriptionSnippet = (value?: string | null) => {
  if (!value) return EMPTY_DESCRIPTION_LABEL;
  const normalized = value.trim();
  return normalized || EMPTY_DESCRIPTION_LABEL;
};

const renderDescriptionSnippet = (value?: string | null) => {
  const snippet = descriptionSnippet(value);
  if (snippet === EMPTY_DESCRIPTION_LABEL) return snippet;
  return renderDescriptionHtml(snippet, { inline: true });
};

const firstAuthor = (item: LibraryItem) =>
  item.author_names?.[0] ?? "Unknown author";

const sortComparators: Record<
  SortMode,
  (a: LibraryItem, b: LibraryItem) => number
> = {
  newest: (a, b) => (b.created_at || "").localeCompare(a.created_at || ""),
  oldest: (a, b) => (a.created_at || "").localeCompare(b.created_at || ""),
  title_asc: (a, b) => a.work_title.localeCompare(b.work_title),
  title_desc: (a, b) => b.work_title.localeCompare(a.work_title),
  author_asc: (a, b) => firstAuthor(a).localeCompare(firstAuthor(b)),
  author_desc: (a, b) => firstAuthor(b).localeCompare(firstAuthor(a)),
  status_asc: (a, b) =>
    statusLabel(a.status).localeCompare(statusLabel(b.status)),
  status_desc: (a, b) =>
    statusLabel(b.status).localeCompare(statusLabel(a.status)),
  rating_asc: (a, b) =>
    (a.rating ?? Infinity) < (b.rating ?? Infinity)
      ? -1
      : (a.rating ?? Infinity) > (b.rating ?? Infinity)
        ? 1
        : 0,
  rating_desc: (a, b) =>
    (b.rating ?? -Infinity) < (a.rating ?? -Infinity)
      ? -1
      : (b.rating ?? -Infinity) > (a.rating ?? -Infinity)
        ? 1
        : 0,
};

const isLibraryViewMode = (value: string): value is LibraryViewMode =>
  value === "list" || value === "grid" || value === "table";

const isTableColumnKey = (value: string): value is TableColumnKey =>
  (ALL_TABLE_COLUMNS as readonly string[]).includes(value);

const readStoredViewMode = (): LibraryViewMode => {
  try {
    const raw = globalThis.localStorage?.getItem(VIEW_MODE_STORAGE_KEY);
    return raw && isLibraryViewMode(raw) ? raw : "list";
  } catch {
    return "list";
  }
};

const writeStoredViewMode = (next: LibraryViewMode) => {
  try {
    globalThis.localStorage?.setItem(VIEW_MODE_STORAGE_KEY, next);
  } catch {
    /* best-effort */
  }
};

const readStoredTableColumns = (): TableColumnKey[] => {
  try {
    const raw = globalThis.localStorage?.getItem(TABLE_COLUMNS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_TABLE_COLUMNS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_TABLE_COLUMNS];
    const valid = parsed.filter(
      (entry): entry is TableColumnKey =>
        typeof entry === "string" && isTableColumnKey(entry),
    );
    return valid.length ? valid : [...DEFAULT_TABLE_COLUMNS];
  } catch {
    return [...DEFAULT_TABLE_COLUMNS];
  }
};

const writeStoredTableColumns = (next: TableColumnKey[]) => {
  try {
    globalThis.localStorage?.setItem(
      TABLE_COLUMNS_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    /* best-effort */
  }
};

/* ─── Merge helpers ─── */

const mergeCandidateRawValue = (
  preview: MergePreviewPayload | null,
  field: MergeFieldKey,
  itemId: string,
) => preview?.fields?.candidates?.[field]?.[itemId];

const mergeCandidateNormalizedValue = (
  preview: MergePreviewPayload | null,
  field: MergeFieldKey,
  itemId: string,
) => {
  const value = mergeCandidateRawValue(preview, field, itemId);
  if (field === "tags") {
    if (!Array.isArray(value)) return "";
    return value.join("||");
  }
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const mergeCandidateLabel = (
  preview: MergePreviewPayload | null,
  field: MergeFieldKey,
  itemId: string,
) => {
  const value = mergeCandidateRawValue(preview, field, itemId);
  if (field === "tags") {
    const tags = Array.isArray(value) ? value : [];
    return tags.length ? tags.join(", ") : "No tags";
  }
  if (field === "status") {
    const s = typeof value === "string" ? value : "";
    if (
      s === "to_read" ||
      s === "reading" ||
      s === "completed" ||
      s === "abandoned"
    )
      return statusLabel(s);
  }
  if (field === "visibility") {
    const v = typeof value === "string" ? value : "";
    if (v === "public" || v === "private") return visibilityLabel(v);
  }
  if (field === "rating") {
    if (value === null || value === undefined) return "No rating";
    return `${String(value)}/10`;
  }
  if (field === "preferred_edition_id") {
    return value ? String(value) : "No preferred edition";
  }
  return value === null || value === undefined || String(value).trim() === ""
    ? "Unset"
    : String(value);
};

/* ─── Page component ─── */

export default function LibraryPage() {
  const supabase = useMemo(() => createBrowserClient(), []);
  const toast = useAppToast();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [statusFilter, setStatusFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");
  const [tagFilterInput, setTagFilterInput] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");
  const [viewMode, setViewMode] = useState<LibraryViewMode>("list");
  const [tableColumns, setTableColumns] = useState<TableColumnKey[]>([
    ...DEFAULT_TABLE_COLUMNS,
  ]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pagination, setPagination] = useState<LibraryPagination>({
    page: 1,
    page_size: 25,
    total_count: 0,
    total_pages: 0,
    from: 0,
    to: 0,
    has_prev: false,
    has_next: false,
  });

  // Per-field update tracking for Inplace loading spinners
  const [itemFieldUpdates, setItemFieldUpdates] = useState<
    Record<string, boolean>
  >({});
  // Controlled Inplace: track which one is open (e.g. "itemId-status")
  const [activeInplaceKey, setActiveInplaceKey] = useState<string | null>(null);

  // Merge state
  const [selectedMergeItems, setSelectedMergeItems] = useState<LibraryItem[]>(
    [],
  );
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeApplying, setMergeApplying] = useState(false);
  const [mergeError, setMergeError] = useState("");
  const [mergePreview, setMergePreview] = useState<MergePreviewPayload | null>(
    null,
  );
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeFieldResolution, setMergeFieldResolution] = useState<
    Record<MergeFieldKey, string>
  >({
    status: "",
    visibility: "",
    rating: "",
    preferred_edition_id: "",
    tags: "combine",
  });

  // Read date dialog state
  const [readDateOpen, setReadDateOpen] = useState(false);
  const [readDateDialogStatus, setReadDateDialogStatus] =
    useState<LibraryItemStatus | null>(null);
  const [readDateTargetItem, setReadDateTargetItem] =
    useState<LibraryItem | null>(null);
  const [readingCurrentStartDate, setReadingCurrentStartDate] =
    useState<Date | null>(null);
  const [previousReadEntries, setPreviousReadEntries] = useState<
    ReadDateEntry[]
  >([]);
  const [completedReadEntries, setCompletedReadEntries] = useState<
    ReadDateEntry[]
  >([]);
  const [readDateFormError, setReadDateFormError] = useState("");
  const [readDateSaving, setReadDateSaving] = useState(false);
  const readDateEntrySeq = useRef(0);
  const readDateMaxDate = useMemo(() => new Date(), []);

  // Remove confirm
  const [pendingRemoveItem, setPendingRemoveItem] =
    useState<LibraryItem | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  /* ─── Computed ─── */

  // Keep a stable display order: only re-sort when sort mode, tag filter,
  // or the set of item IDs changes — NOT when field values update in-place.
  const sortedOrderRef = useRef<string[]>([]);
  const prevSortRef = useRef(sort);
  const prevTagFilterRef = useRef(tagFilter);
  const prevItemIdsRef = useRef("");

  const displayItems = useMemo(() => {
    const itemIds = items
      .map((i) => i.id)
      .sort()
      .join(",");
    const needsResort =
      sort !== prevSortRef.current ||
      tagFilter !== prevTagFilterRef.current ||
      itemIds !== prevItemIdsRef.current;

    prevSortRef.current = sort;
    prevTagFilterRef.current = tagFilter;
    prevItemIdsRef.current = itemIds;

    if (!needsResort && sortedOrderRef.current.length > 0) {
      // Item values changed but the set is the same — preserve current order
      const lookup = new Map(items.map((i) => [i.id, i]));
      return sortedOrderRef.current
        .map((id) => lookup.get(id))
        .filter((i): i is LibraryItem => i != null);
    }

    const filtered = tagFilter.trim()
      ? items.filter((item) =>
          Array.isArray(item.tags)
            ? item.tags.some((t) =>
                t.toLowerCase().includes(tagFilter.trim().toLowerCase()),
              )
            : false,
        )
      : items;
    const sorted = [...filtered];
    sorted.sort(sortComparators[sort]);
    sortedOrderRef.current = sorted.map((i) => i.id);
    return sorted;
  }, [items, sort, tagFilter]);

  const pageRangeLabel = useMemo(() => {
    if (!pagination.total_count || !pagination.total_pages) return "0 items";
    return `${pagination.from}-${pagination.to} of ${pagination.total_count}`;
  }, [pagination]);

  const isColumnVisible = useCallback(
    (key: TableColumnKey) => tableColumns.includes(key),
    [tableColumns],
  );

  /* ─── Sort icons ─── */

  const getSortIcon = (
    ascMode: SortMode,
    descMode: SortMode,
    type: "alpha" | "amount" = "alpha",
  ) => {
    if (sort === ascMode)
      return type === "alpha"
        ? "pi pi-sort-alpha-down"
        : "pi pi-sort-amount-up";
    if (sort === descMode)
      return type === "alpha"
        ? "pi pi-sort-alpha-up-alt"
        : "pi pi-sort-amount-down";
    return "pi pi-sort-alt";
  };

  /* ─── Item field update tracking ─── */

  const itemFieldUpdateKey = (
    itemId: string,
    field: "status" | "visibility",
  ) => `${itemId}:${field}`;

  const isItemFieldUpdating = (
    itemId: string,
    field: "status" | "visibility",
  ) => Boolean(itemFieldUpdates[itemFieldUpdateKey(itemId, field)]);

  const isItemUpdating = (itemId: string) =>
    isItemFieldUpdating(itemId, "status") ||
    isItemFieldUpdating(itemId, "visibility");

  /* ─── API ─── */

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{
        items: LibraryItem[];
        pagination?: LibraryPagination;
        next_cursor?: string | null;
      }>(supabase, "/api/v1/library/items", {
        query: {
          page,
          page_size: pageSize,
          sort,
          status: statusFilter || undefined,
          visibility: visibilityFilter || undefined,
          tag: tagFilter || undefined,
        },
      });

      setItems(payload.items);
      setSelectedMergeItems((current) =>
        current.filter((sel) =>
          payload.items.some((item) => item.id === sel.id),
        ),
      );
      setPagination(
        payload.pagination ?? {
          page,
          page_size: pageSize,
          total_count: payload.items.length,
          total_pages: payload.items.length > 0 ? page : 0,
          from: payload.items.length > 0 ? (page - 1) * pageSize + 1 : 0,
          to: (page - 1) * pageSize + payload.items.length,
          has_prev: page > 1,
          has_next: Boolean(payload.next_cursor),
        },
      );
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to load library items right now.",
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, sort, statusFilter, visibilityFilter, tagFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setTagFilter(tagFilterInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [tagFilterInput]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  useEffect(() => {
    const onUpdated = () => void fetchPage();
    window.addEventListener(LIBRARY_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(LIBRARY_UPDATED_EVENT, onUpdated);
  }, [fetchPage]);

  // Restore persisted view mode and columns on mount
  useEffect(() => {
    setViewMode(readStoredViewMode());
    setTableColumns(readStoredTableColumns());
  }, []);

  // Persist view mode and columns on change
  useEffect(() => {
    writeStoredViewMode(viewMode);
    if (viewMode !== "table") {
      setSelectedMergeItems([]);
    }
  }, [viewMode]);

  useEffect(() => {
    writeStoredTableColumns(tableColumns);
  }, [tableColumns]);

  /* ─── Item update ─── */

  const updateItem = async (
    item: LibraryItem,
    field: "status" | "visibility",
    value: string,
  ) => {
    const previous = item[field];
    const next =
      field === "status"
        ? (value as LibraryItemStatus)
        : (value as LibraryItemVisibility);
    if (previous === next) return false;

    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, [field]: next } : entry,
      ),
    );
    const key = itemFieldUpdateKey(item.id, field);
    setItemFieldUpdates((prev) => ({ ...prev, [key]: true }));

    try {
      const payload = await apiRequest<LibraryItem>(
        supabase,
        `/api/v1/library/items/${item.id}`,
        { method: "PATCH", body: { [field]: next } },
      );
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, ...payload } : entry)),
      );
      toast.show({
        severity: "success",
        summary: field === "status" ? "Status updated." : "Visibility updated.",
        life: 2200,
      });
      if (field === "status" && (next === "reading" || next === "completed")) {
        openReadDatePrompt(payload, next);
      }
      return true;
    } catch (err) {
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, [field]: previous } : entry,
        ),
      );
      if (err instanceof ApiClientError && err.status === 404) {
        toast.show({
          severity: "info",
          summary: "This item was already removed. Refreshing...",
          life: 2500,
        });
        void fetchPage();
      } else {
        const msg =
          err instanceof ApiClientError
            ? err.message
            : "Unable to update this item right now.";
        toast.show({ severity: "error", summary: msg, life: 3000 });
      }
      return false;
    } finally {
      setItemFieldUpdates((prev) => {
        const rest = { ...prev };
        delete rest[key];
        return rest;
      });
    }
  };

  const updateRating = async (item: LibraryItem, starValue: number) => {
    const newRating = starValue === 0 ? null : starValue * 2;
    const previous = item.rating;
    if (previous === newRating) return;

    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, rating: newRating } : entry,
      ),
    );
    const key = itemFieldUpdateKey(item.id, "rating");
    setItemFieldUpdates((prev) => ({ ...prev, [key]: true }));

    try {
      const payload = await apiRequest<LibraryItem>(
        supabase,
        `/api/v1/library/items/${item.id}`,
        { method: "PATCH", body: { rating: newRating } },
      );
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, ...payload } : entry)),
      );
      toast.show({
        severity: "success",
        summary: newRating ? `Rated ${newRating}/10.` : "Rating cleared.",
        life: 2200,
      });
    } catch (err) {
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, rating: previous } : entry,
        ),
      );
      const msg =
        err instanceof ApiClientError
          ? err.message
          : "Unable to update rating right now.";
      toast.show({ severity: "error", summary: msg, life: 3000 });
    } finally {
      setItemFieldUpdates((prev) => {
        const rest = { ...prev };
        delete rest[key];
        return rest;
      });
    }
  };

  /* ─── Sort toggles ─── */

  const toggleSort = (ascMode: SortMode, descMode: SortMode) => {
    setSort((current) => (current === ascMode ? descMode : ascMode));
  };

  /* ─── Read date dialog ─── */

  const buildReadDateEntry = (): ReadDateEntry => ({
    key: `entry-${readDateEntrySeq.current++}`,
    startedAt: null,
    endedAt: null,
  });

  const openReadDatePrompt = (item: LibraryItem, status: LibraryItemStatus) => {
    setReadDateTargetItem(item);
    setReadDateDialogStatus(status);
    setReadingCurrentStartDate(status === "reading" ? new Date() : null);
    setPreviousReadEntries([]);
    setCompletedReadEntries(
      status === "completed"
        ? [
            {
              key: buildReadDateEntry().key,
              startedAt: new Date(),
              endedAt: new Date(),
            },
          ]
        : [],
    );
    setReadDateFormError("");
    setReadDateOpen(true);
  };

  const closeReadDatePrompt = () => {
    setReadDateOpen(false);
    setReadDateDialogStatus(null);
    setReadDateTargetItem(null);
    setReadingCurrentStartDate(null);
    setPreviousReadEntries([]);
    setCompletedReadEntries([]);
    setReadDateFormError("");
  };

  const dateStartIso = (value: Date) =>
    new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      0,
      0,
      0,
      0,
    ).toISOString();

  const dateEndIso = (value: Date) =>
    new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      23,
      59,
      59,
      999,
    ).toISOString();

  const readDateRangeModel = (
    entry: ReadDateEntry,
  ): (Date | null)[] | null => {
    const dates = [entry.startedAt, entry.endedAt].filter(
      (v): v is Date => v instanceof Date,
    );
    return dates.length ? dates : null;
  };

  const validatedReadDatePayloads = () => {
    const status = readDateDialogStatus;
    if (!status) return null;

    if (status === "reading") {
      if (!readingCurrentStartDate) {
        setReadDateFormError("Add a start date for your current read.");
        return null;
      }
      const payloads: Array<{ started_at: string; ended_at?: string }> = [
        { started_at: dateStartIso(readingCurrentStartDate) },
      ];
      for (const entry of previousReadEntries) {
        if (!entry.startedAt || !entry.endedAt) {
          setReadDateFormError(
            "Each previous read needs both a start and finish date.",
          );
          return null;
        }
        if (entry.endedAt < entry.startedAt) {
          setReadDateFormError(
            "Finish dates must be the same as or after start dates.",
          );
          return null;
        }
        payloads.push({
          started_at: dateStartIso(entry.startedAt),
          ended_at: dateEndIso(entry.endedAt),
        });
      }
      return payloads;
    }

    if (completedReadEntries.length === 0) {
      setReadDateFormError("Add at least one completed read.");
      return null;
    }
    const payloads: Array<{ started_at: string; ended_at?: string }> = [];
    for (const entry of completedReadEntries) {
      if (!entry.startedAt || !entry.endedAt) {
        setReadDateFormError(
          "Each completed read needs both a start and finish date.",
        );
        return null;
      }
      if (entry.endedAt < entry.startedAt) {
        setReadDateFormError(
          "Finish dates must be the same as or after start dates.",
        );
        return null;
      }
      payloads.push({
        started_at: dateStartIso(entry.startedAt),
        ended_at: dateEndIso(entry.endedAt),
      });
    }
    return payloads;
  };

  const saveReadDatePrompt = async (quickToday = false) => {
    if (readDateSaving) return;
    const item = readDateTargetItem;
    const status = readDateDialogStatus;
    if (!item || !status) return;

    if (quickToday) {
      const today = new Date();
      if (status === "reading") {
        setReadingCurrentStartDate(today);
      } else if (completedReadEntries.length === 0) {
        setCompletedReadEntries([
          { key: buildReadDateEntry().key, startedAt: today, endedAt: today },
        ]);
      } else {
        setCompletedReadEntries((entries) =>
          entries.map((entry, index) =>
            index === 0 ? { ...entry, startedAt: today, endedAt: today } : entry,
          ),
        );
      }
    }

    setReadDateFormError("");
    const payloads = validatedReadDatePayloads();
    if (!payloads) return;

    setReadDateSaving(true);
    try {
      await Promise.all(
        payloads.map((body) =>
          apiRequest(
            supabase,
            `/api/v1/library/items/${item.id}/sessions`,
            { method: "POST", body },
          ),
        ),
      );
      toast.show({
        severity: "success",
        summary:
          status === "completed"
            ? `Saved ${payloads.length} completed read${payloads.length === 1 ? "" : "s"}.`
            : "Reading dates saved.",
        life: 2200,
      });
      closeReadDatePrompt();
      await fetchPage();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        toast.show({
          severity: "info",
          summary: "This item was already removed. Refreshing...",
          life: 2500,
        });
        closeReadDatePrompt();
        void fetchPage();
      } else {
        setReadDateFormError(
          err instanceof ApiClientError
            ? err.message
            : "Unable to save reading date.",
        );
      }
    } finally {
      setReadDateSaving(false);
    }
  };

  /* ─── Merge ─── */

  const mergeFieldResolutionPayload = () => {
    const payload: Partial<Record<MergeFieldKey, string>> = {};
    for (const [field, value] of Object.entries(mergeFieldResolution)) {
      if (typeof value === "string" && value.trim()) {
        payload[field as MergeFieldKey] = value;
      }
    }
    return payload;
  };

  const mergeFieldHasConflicts = (field: MergeFieldKey) => {
    const itemIds = selectedMergeItems
      .map((item) => item.id)
      .filter(
        (id) =>
          mergeCandidateRawValue(mergePreview, field, id) !== undefined,
      );
    if (itemIds.length < 2) return false;
    const first = mergeCandidateNormalizedValue(
      mergePreview,
      field,
      itemIds[0],
    );
    return itemIds.some(
      (id) =>
        mergeCandidateNormalizedValue(mergePreview, field, id) !== first,
    );
  };

  const mergeUniformFieldLabel = (field: MergeFieldKey) => {
    const itemIds = selectedMergeItems
      .map((item) => item.id)
      .filter(
        (id) =>
          mergeCandidateRawValue(mergePreview, field, id) !== undefined,
      );
    const itemId = itemIds[0];
    if (!itemId) {
      if (field === "tags") return "No tags";
      if (field === "rating") return "No rating";
      if (field === "preferred_edition_id") return "No preferred edition";
      return "Unset";
    }
    return mergeCandidateLabel(mergePreview, field, itemId);
  };

  const mergeResolutionOptions = (field: MergeFieldKey) => {
    const keepOptions = selectedMergeItems.map((item) => ({
      label: `${mergeCandidateLabel(mergePreview, field, item.id)} (${item.work_title})`,
      value: `keep:${item.id}`,
    }));
    if (field === "tags") {
      return [{ label: "Combine all tags", value: "combine" }, ...keepOptions];
    }
    return keepOptions;
  };

  const loadMergePreview = async (targetId: string, itemIds: string[]) => {
    if (itemIds.length < 2 || !targetId) return;
    setMergeLoading(true);
    setMergeError("");
    try {
      const payload = await apiRequest<MergePreviewPayload>(
        supabase,
        "/api/v1/library/items/merge/preview",
        {
          method: "POST",
          body: {
            item_ids: itemIds,
            target_item_id: targetId,
            field_resolution: mergeFieldResolutionPayload(),
          },
        },
      );
      setMergePreview(payload);
    } catch (err) {
      setMergePreview(null);
      setMergeError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to load merge preview right now.",
      );
    } finally {
      setMergeLoading(false);
    }
  };

  const openMerge = async () => {
    if (selectedMergeItems.length < 2) return;
    const targetId = selectedMergeItems[0]?.id ?? "";
    setMergeTargetId(targetId);
    setMergeOpen(true);
    setMergeError("");
    setMergePreview(null);
    setMergeFieldResolution({
      status: "",
      visibility: "",
      rating: "",
      preferred_edition_id: "",
      tags: "combine",
    });
    await loadMergePreview(
      targetId,
      selectedMergeItems.map((i) => i.id),
    );
  };

  const closeMergeDialog = () => {
    if (mergeApplying) return;
    setMergeOpen(false);
    setMergeLoading(false);
    setMergeError("");
    setMergePreview(null);
    setMergeTargetId("");
    setMergeFieldResolution({
      status: "",
      visibility: "",
      rating: "",
      preferred_edition_id: "",
      tags: "combine",
    });
  };

  const applyMerge = async () => {
    if (mergeApplying || !mergePreview) return;
    setMergeApplying(true);
    setMergeError("");
    try {
      await apiRequest(supabase, "/api/v1/library/items/merge", {
        method: "POST",
        body: {
          item_ids: selectedMergeItems.map((i) => i.id),
          target_item_id: mergeTargetId,
          field_resolution: mergeFieldResolutionPayload(),
        },
      });
      toast.show({
        severity: "success",
        summary: "Books merged successfully.",
        life: 3000,
      });
      setSelectedMergeItems([]);
      closeMergeDialog();
      await fetchPage();
    } catch (err) {
      setMergeError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to merge selected books right now.",
      );
    } finally {
      setMergeApplying(false);
    }
  };

  /* ─── Remove ─── */

  const confirmRemove = async () => {
    if (!pendingRemoveItem) return;
    setRemoveLoading(true);
    try {
      await apiRequest(
        supabase,
        `/api/v1/library/items/${pendingRemoveItem.id}`,
        { method: "DELETE" },
      );
      setItems((current) =>
        current.filter((entry) => entry.id !== pendingRemoveItem.id),
      );
      window.dispatchEvent(new Event(LIBRARY_UPDATED_EVENT));
      toast.show({
        severity: "success",
        summary: "Removed from your library.",
        life: 2500,
      });
      setPendingRemoveItem(null);
      if (items.length === 1 && page > 1) {
        setPage((current) => current - 1);
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        toast.show({
          severity: "info",
          summary: "This item was already removed. Refreshing...",
          life: 2500,
        });
        setPendingRemoveItem(null);
        void fetchPage();
      } else {
        const msg =
          err instanceof ApiClientError
            ? err.message
            : "Unable to remove this item right now.";
        toast.show({ severity: "error", summary: msg, life: 3000 });
      }
    } finally {
      setRemoveLoading(false);
    }
  };

  /* ─── Inplace editors ─── */

  const renderStatusInplace = (item: LibraryItem) => {
    const key = `${item.id}-status`;
    return (
      <Inplace
        active={activeInplaceKey === key}
        onToggle={(e) => setActiveInplaceKey(e.value ? key : null)}
        disabled={isItemUpdating(item.id)}
        className="library-inline-editor"
      >
        <InplaceDisplay>
          <Tag
            value={statusLabel(item.status)}
            pt={statusTagPt(item.status)}
            icon="pi pi-bookmark"
            rounded
            data-test="library-item-status-chip"
          />
        </InplaceDisplay>
        <InplaceContent>
          <Dropdown
            value={item.status}
            options={STATUS_OPTIONS}
            optionLabel="label"
            optionValue="value"
            className="w-[11rem]"
            data-test="library-item-status-edit"
            data-item-id={item.id}
            disabled={isItemUpdating(item.id)}
            onChange={(event) => {
              setActiveInplaceKey(null);
              void updateItem(item, "status", event.value);
            }}
            onHide={() => setActiveInplaceKey(null)}
          />
        </InplaceContent>
      </Inplace>
    );
  };

  const renderVisibilityInplace = (item: LibraryItem) => {
    const key = `${item.id}-visibility`;
    return (
      <Inplace
        active={activeInplaceKey === key}
        onToggle={(e) => setActiveInplaceKey(e.value ? key : null)}
        disabled={isItemUpdating(item.id)}
        className="library-inline-editor"
      >
        <InplaceDisplay>
          <Tag
            value={visibilityLabel(item.visibility)}
            pt={visibilityTagPt(item.visibility)}
            icon={visibilityTagIcon(item.visibility)}
            rounded
            data-test="library-item-visibility-chip"
          />
        </InplaceDisplay>
        <InplaceContent>
          <Dropdown
            value={item.visibility}
            options={VISIBILITY_OPTIONS}
            optionLabel="label"
            optionValue="value"
            className="w-[11rem]"
            data-test="library-item-visibility-edit"
            data-item-id={item.id}
            disabled={isItemUpdating(item.id)}
            onChange={(event) => {
              setActiveInplaceKey(null);
              void updateItem(item, "visibility", event.value);
            }}
            onHide={() => setActiveInplaceKey(null)}
          />
        </InplaceContent>
      </Inplace>
    );
  };

  /* ─── Merge dialog field row ─── */

  const renderMergeFieldRow = (field: MergeFieldKey, label: string) => {
    const hasConflicts = mergeFieldHasConflicts(field);
    const testIdPrefix = field === "preferred_edition_id" ? "edition" : field;
    return (
      <div
        key={field}
        className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr] sm:items-center"
      >
        <span className="text-sm font-medium">{label}</span>
        {!hasConflicts ? (
          <div
            className="merge-field-value"
            data-test={`library-merge-field-${testIdPrefix}-value`}
          >
            {mergeUniformFieldLabel(field)}
          </div>
        ) : (
          <Dropdown
            value={mergeFieldResolution[field]}
            options={mergeResolutionOptions(field)}
            optionLabel="label"
            optionValue="value"
            data-test={`library-merge-field-${testIdPrefix}`}
            disabled={mergeApplying}
            onChange={(event) =>
              setMergeFieldResolution((prev) => ({
                ...prev,
                [field]: event.value as string,
              }))
            }
          />
        )}
      </div>
    );
  };

  /* ─── Render ─── */

  return (
    <Card className="rounded-xl" data-test="library-card">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <i
            className="pi pi-book text-[var(--p-primary-color)]"
            aria-hidden="true"
          />
          <div>
            <p className="font-heading text-xl font-semibold tracking-tight">
              Your library
            </p>
            <p className="text-sm text-[var(--p-text-muted-color)]">
              Filter, sort, and jump back into a book.
            </p>
            <p
              className="text-xs text-[var(--p-text-muted-color)]"
              data-test="library-range-summary"
            >
              {pageRangeLabel}
            </p>
          </div>
        </div>
      </div>

      <Card className="mt-4">
        <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-6">
          <SelectButton
            data-test="library-view-select"
            className="min-w-0 w-full"
            value={viewMode}
            options={VIEW_OPTIONS}
            optionLabel="label"
            optionValue="value"
            onChange={(event) => {
              if (event.value) setViewMode(event.value as LibraryViewMode);
            }}
          />
          <Dropdown
            data-test="library-status-filter"
            className="min-w-0 w-full"
            placeholder="All statuses"
            value={statusFilter}
            options={[{ label: "All statuses", value: "" }, ...STATUS_OPTIONS]}
            optionLabel="label"
            optionValue="value"
            onChange={(event) => {
              setStatusFilter((event.value as string) ?? "");
              setPage(1);
            }}
          />
          <Dropdown
            data-test="library-visibility-filter"
            className="min-w-0 w-full"
            placeholder="All visibilities"
            value={visibilityFilter}
            options={[
              { label: "All visibilities", value: "" },
              ...VISIBILITY_OPTIONS,
            ]}
            optionLabel="label"
            optionValue="value"
            onChange={(event) => {
              setVisibilityFilter((event.value as string) ?? "");
              setPage(1);
            }}
          />
          <InputText
            data-test="library-tag-filter"
            className="min-w-0 w-full"
            value={tagFilterInput}
            onChange={(event) => setTagFilterInput(event.target.value)}
            placeholder="Filter by tag"
          />
          {viewMode === "table" ? (
            <MultiSelect
              data-test="library-columns-select"
              className="min-w-0 w-full"
              value={tableColumns}
              options={TABLE_COLUMN_OPTIONS}
              optionLabel="label"
              optionValue="value"
              display="chip"
              maxSelectedLabels={1}
              selectedItemsLabel="{0} columns"
              placeholder="Columns"
              onChange={(event) =>
                setTableColumns(event.value as TableColumnKey[])
              }
            />
          ) : null}
        </div>
        {viewMode === "table" ? (
          <div className="mt-3 flex items-center justify-end">
            <Button
              label="Merge selected"
              icon="pi pi-clone"
              data-test="library-merge-open"
              disabled={selectedMergeItems.length < 2 || loading}
              onClick={() => void openMerge()}
            />
          </div>
        ) : null}
      </Card>

      {error ? (
        <Message className="mt-3" severity="error" data-test="library-error" text={error} />
      ) : null}

      {/* Skeleton loading */}
      {loading ? (
        <div className="mt-4 grid gap-3" data-test="library-loading">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index}>
              <div className="flex items-start gap-4">
                <Skeleton
                  width="80px"
                  height="120px"
                  borderRadius="0.5rem"
                  className="shrink-0"
                />
                <div className="flex flex-1 flex-col gap-2 pt-1">
                  <Skeleton width="75%" height="1.25rem" />
                  <Skeleton width="50%" height="1rem" />
                  <div className="mt-2 flex gap-2">
                    <Skeleton
                      width="4rem"
                      height="1.25rem"
                      borderRadius="9999px"
                    />
                    <Skeleton
                      width="3.5rem"
                      height="1.25rem"
                      borderRadius="9999px"
                    />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Content */}
      {!loading && displayItems.length > 0 ? (
        <>
          {/* ─── TABLE VIEW ─── */}
          {viewMode === "table" ? (
            <div className="mt-4" data-test="library-items">
              <div
                data-test="library-data-view"
                className="w-full overflow-x-auto"
              >
                <DataTable
                  value={displayItems}
                  selection={selectedMergeItems}
                  onSelectionChange={(e) =>
                    setSelectedMergeItems(e.value as LibraryItem[])
                  }
                  dataKey="id"
                  selectionMode="multiple"
                  stripedRows
                  rowHover
                  size="small"
                  scrollable
                  className="w-full library-table"
                  data-test="library-items-table"
                >
                  <Column
                    selectionMode="multiple"
                    className="w-[3rem] min-w-[3rem]"
                  />
                  {isColumnVisible("cover") ? (
                    <Column
                      className="w-[72px] min-w-[72px]"
                      header={
                        <span className="library-header-label">Cover</span>
                      }
                      body={(item: LibraryItem) => (
                        <div className="flex justify-center">
                          <div className="h-14 w-10 overflow-hidden rounded-md border border-[var(--p-content-border-color)] bg-black/5 dark:bg-white/5">
                            {item.cover_url ? (
                              <Image
                                src={item.cover_url}
                                alt=""
                                width={40}
                                height={56}
                                unoptimized
                                className="h-full w-full object-cover"
                                data-test="library-item-cover"
                              />
                            ) : (
                              <CoverPlaceholder data-test="library-item-cover-placeholder" />
                            )}
                          </div>
                        </div>
                      )}
                    />
                  ) : null}
                  {isColumnVisible("title") ? (
                    <Column
                      className="min-w-[14rem]"
                      header={
                        <button
                          type="button"
                          className="library-sort-trigger"
                          data-test="library-table-sort-title"
                          onClick={() =>
                            toggleSort("title_asc", "title_desc")
                          }
                        >
                          Title
                          <i
                            className={getSortIcon(
                              "title_asc",
                              "title_desc",
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      }
                      body={(item: LibraryItem) => (
                        <div className="min-w-0">
                          <Link
                            href={`/books/${item.work_id}`}
                            className="line-clamp-1 block font-semibold text-[var(--p-primary-color)] no-underline hover:underline"
                            data-test="library-item-title-link"
                          >
                            {item.work_title}
                          </Link>
                        </div>
                      )}
                    />
                  ) : null}
                  {isColumnVisible("author") ? (
                    <Column
                      className="min-w-[14rem]"
                      header={
                        <button
                          type="button"
                          className="library-sort-trigger"
                          data-test="library-table-sort-author"
                          onClick={() =>
                            toggleSort("author_asc", "author_desc")
                          }
                        >
                          Author
                          <i
                            className={getSortIcon(
                              "author_asc",
                              "author_desc",
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      }
                      body={(item: LibraryItem) => (
                        <p className="line-clamp-1 text-sm text-[var(--p-text-muted-color)]">
                          {item.author_names?.join(", ") || "Unknown author"}
                        </p>
                      )}
                    />
                  ) : null}
                  {isColumnVisible("status") ? (
                    <Column
                      className="min-w-[8rem]"
                      style={{ paddingLeft: "0.5rem", paddingRight: "0.5rem" }}
                      header={
                        <button
                          type="button"
                          className="library-sort-trigger"
                          data-test="library-table-sort-status"
                          onClick={() =>
                            toggleSort("status_asc", "status_desc")
                          }
                        >
                          Status
                          <i
                            className={getSortIcon(
                              "status_asc",
                              "status_desc",
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      }
                      body={(item: LibraryItem) => (
                        <div className="flex justify-center">
                          {renderStatusInplace(item)}
                        </div>
                      )}
                    />
                  ) : null}
                  <Column
                    className="min-w-[8rem]"
                    style={{ paddingLeft: "0.5rem", paddingRight: "0.5rem" }}
                    header={
                      <span className="library-header-label">Visibility</span>
                    }
                    body={(item: LibraryItem) => (
                      <div className="flex justify-center">
                        {renderVisibilityInplace(item)}
                      </div>
                    )}
                  />
                  {isColumnVisible("description") ? (
                    <Column
                      className="min-w-[18rem]"
                      header={
                        <span className="library-header-label">
                          Description
                        </span>
                      }
                      body={(item: LibraryItem) => (
                        <p
                          className="library-description line-clamp-2 text-sm text-[var(--p-text-muted-color)]"
                          data-test="library-item-description"
                          dangerouslySetInnerHTML={{
                            __html: renderDescriptionSnippet(
                              item.work_description,
                            ),
                          }}
                        />
                      )}
                    />
                  ) : null}
                  {isColumnVisible("rating") ? (
                    <Column
                      className="min-w-[12rem]"
                      header={
                        <button
                          type="button"
                          className="library-sort-trigger"
                          data-test="library-table-sort-rating"
                          onClick={() =>
                            toggleSort("rating_asc", "rating_desc")
                          }
                        >
                          Rating
                          <i
                            className={getSortIcon(
                              "rating_asc",
                              "rating_desc",
                              "amount",
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      }
                      body={(item: LibraryItem) => (
                        <div
                          className="flex justify-center"
                          data-test="library-item-rating"
                        >
                          <HalfStarRating value={ratingValue(item.rating)} className="text-xs" onChange={(v) => updateRating(item, v)} />
                        </div>
                      )}
                    />
                  ) : null}
                  {isColumnVisible("tags") ? (
                    <Column
                      className="min-w-[10rem]"
                      header={
                        <span className="library-header-label">Tags</span>
                      }
                      body={(item: LibraryItem) => (
                        <div className="flex flex-wrap items-center gap-1">
                          {visibleTags(item.tags, 2).map((tag) => (
                            <div
                              key={`${item.id}-${tag}`}
                              className="library-meta-chip"
                            >
                              {tag}
                            </div>
                          ))}
                          {remainingTagCount(item.tags, 2) > 0 ? (
                            <span className="text-xs text-[var(--p-text-muted-color)]">
                              +{remainingTagCount(item.tags, 2)}
                            </span>
                          ) : null}
                          {!visibleTags(item.tags, 2).length ? (
                            <span className="text-xs text-[var(--p-text-muted-color)]">
                              —
                            </span>
                          ) : null}
                        </div>
                      )}
                    />
                  ) : null}
                  {isColumnVisible("recommendations") ? (
                    <Column
                      className="min-w-[10rem]"
                      header={
                        <span className="library-header-label">
                          Friends recs
                        </span>
                      }
                      body={(item: LibraryItem) => (
                        <div
                          className="library-meta-chip"
                          data-test="library-item-recs"
                        >
                          <i
                            className="pi pi-users text-xs"
                            aria-hidden="true"
                          />
                          <span>
                            {recommendationLabel(
                              item.friend_recommendations_count,
                            )}
                          </span>
                        </div>
                      )}
                    />
                  ) : null}
                  {isColumnVisible("last_read") ? (
                    <Column
                      className="min-w-[8rem]"
                      header={
                        <span className="library-header-label">Last read</span>
                      }
                      body={(item: LibraryItem) =>
                        formatDate(item.last_read_at)
                      }
                    />
                  ) : null}
                  {isColumnVisible("added") ? (
                    <Column
                      className="min-w-[8rem]"
                      header={
                        <button
                          type="button"
                          className="library-sort-trigger"
                          data-test="library-table-sort-added"
                          onClick={() => toggleSort("oldest", "newest")}
                        >
                          Added
                          <i
                            className={getSortIcon(
                              "oldest",
                              "newest",
                              "amount",
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      }
                      body={(item: LibraryItem) => (
                        <span className="block text-center">
                          {formatDate(item.created_at)}
                        </span>
                      )}
                    />
                  ) : null}
                  <Column
                    className="w-[7rem] min-w-[7rem]"
                    header={
                      <span className="library-header-label">Actions</span>
                    }
                    body={(item: LibraryItem) => (
                      <div className="flex justify-center">
                        <Button
                          icon="pi pi-trash"
                          size="small"
                          text
                          severity="secondary"
                          aria-label="Remove from library"
                          className="opacity-70 transition-opacity hover:opacity-100"
                          data-test="library-item-remove"
                          disabled={isItemUpdating(item.id)}
                          onClick={() => setPendingRemoveItem(item)}
                        />
                      </div>
                    )}
                  />
                </DataTable>
              </div>
            </div>
          ) : null}

          {/* ─── LIST VIEW ─── */}
          {viewMode === "list" ? (
            <div className="mt-4 grid gap-3" data-test="library-items">
              <div data-test="library-data-view">
                {displayItems.map((item) => (
                  <div key={item.id} className="mb-3">
                    <Card className="transition-shadow duration-200 hover:shadow-md">
                      <div className="grid grid-cols-1 gap-3 md:h-[16rem] md:grid-cols-[10.75rem_minmax(0,1fr)_auto] md:items-stretch md:gap-4">
                        <div className="mx-auto h-[168px] w-[112px] shrink-0 overflow-hidden rounded-lg border border-[var(--p-content-border-color)] md:mx-0 md:h-full md:w-full">
                          {item.cover_url ? (
                            <Image
                              src={item.cover_url}
                              alt=""
                              width={112}
                              height={168}
                              unoptimized
                              className="h-full w-full object-contain"
                              data-test="library-item-cover"
                            />
                          ) : (
                            <CoverPlaceholder data-test="library-item-cover-placeholder" />
                          )}
                        </div>
                        <div className="min-w-0 flex min-h-[168px] flex-col">
                          <Link
                            href={`/books/${item.work_id}`}
                            className="line-clamp-2 font-heading text-lg font-semibold tracking-tight text-[var(--p-primary-color)] no-underline hover:underline"
                            data-test="library-item-title-link"
                          >
                            {item.work_title}
                          </Link>
                          {item.author_names?.length ? (
                            <p className="mt-0.5 truncate text-sm text-[var(--p-text-muted-color)]">
                              {item.author_names.join(", ")}
                            </p>
                          ) : null}
                          <p
                            className="library-description mt-1 line-clamp-6 overflow-hidden text-sm text-[var(--p-text-muted-color)]"
                            data-test="library-item-description"
                            dangerouslySetInnerHTML={{
                              __html: renderDescriptionSnippet(
                                item.work_description,
                              ),
                            }}
                          />
                          <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--p-content-border-color)]/60 pt-2">
                            {renderStatusInplace(item)}
                            {renderVisibilityInplace(item)}
                            <div
                              className="flex min-w-[7rem] flex-col items-center justify-center gap-0.5 text-center text-xs"
                              data-test="library-item-rating"
                            >
                              <HalfStarRating value={ratingValue(item.rating)} className="text-xs" onChange={(v) => updateRating(item, v)} />
                              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--p-text-muted-color)]">
                                Rating
                              </span>
                            </div>
                            <div
                              className="library-meta-chip"
                              data-test="library-item-recs"
                            >
                              <i
                                className="pi pi-users text-xs"
                                aria-hidden="true"
                              />
                              <span>
                                {recommendationLabel(
                                  item.friend_recommendations_count,
                                )}
                              </span>
                            </div>
                            {visibleTags(item.tags, 2).map((tag) => (
                              <div
                                key={`${item.id}-${tag}`}
                                className="library-meta-chip"
                              >
                                {tag}
                              </div>
                            ))}
                            {remainingTagCount(item.tags, 2) > 0 ? (
                              <div className="library-meta-chip">
                                +{remainingTagCount(item.tags, 2)}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="shrink-0 md:self-start">
                          <Button
                            icon="pi pi-trash"
                            size="small"
                            text
                            severity="secondary"
                            className="self-start opacity-70 transition-opacity hover:opacity-100"
                            aria-label="Remove from library"
                            data-test="library-item-remove"
                            disabled={isItemUpdating(item.id)}
                            onClick={() => setPendingRemoveItem(item)}
                          />
                        </div>
                      </div>
                    </Card>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* ─── GRID VIEW ─── */}
          {viewMode === "grid" ? (
            <div data-test="library-items" className="mt-4">
              <div
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                data-test="library-items-grid"
              >
                {displayItems.map((item) => (
                  <Card
                    key={item.id}
                    className="group h-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                    pt={{
                      body: { style: { padding: "0.75rem" } },
                      content: { style: { padding: 0 } },
                    }}
                  >
                    <div className="flex h-full flex-col gap-1 pt-1">
                      <div className="grid" style={{ gridTemplateColumns: "57% 1fr" }}>
                        <div className="overflow-hidden rounded-md transition-transform duration-200 group-hover:scale-[1.02]" style={{ aspectRatio: "2/3" }}>
                          {item.cover_url ? (
                            <Image
                              src={item.cover_url}
                              alt=""
                              width={256}
                              height={384}
                              unoptimized
                              className="block h-full w-full object-cover"
                              data-test="library-item-cover"
                            />
                          ) : (
                            <CoverPlaceholder data-test="library-item-cover-placeholder" />
                          )}
                        </div>
                        <div className="flex min-w-0 items-start justify-center">
                          <div className="flex h-full w-full flex-col items-center justify-between pb-1">
                            <div className="flex w-full justify-end">
                              <Button
                                icon="pi pi-trash"
                                size="small"
                                text
                                severity="secondary"
                                className="opacity-70 transition-opacity hover:opacity-100"
                                style={{ paddingTop: 0, paddingBottom: 0 }}
                                aria-label="Remove from library"
                                data-test="library-item-remove"
                                disabled={isItemUpdating(item.id)}
                                onClick={() => setPendingRemoveItem(item)}
                              />
                            </div>
                            <div>
                              {renderStatusInplace(item)}
                            </div>
                            <div>
                              {renderVisibilityInplace(item)}
                            </div>
                            <div
                              className="flex flex-col items-center gap-0.5 text-center"
                              data-test="library-item-rating"
                            >
                              <HalfStarRating value={ratingValue(item.rating)} className="text-xs" onChange={(v) => updateRating(item, v)} />
                              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--p-text-muted-color)]">
                                Rating
                              </span>
                            </div>
                            <div
                              className="flex items-center gap-1.5 whitespace-nowrap text-[var(--p-text-muted-color)]"
                              data-test="library-item-recs"
                            >
                              <i
                                className="pi pi-users text-sm"
                                aria-hidden="true"
                              />
                              <span className="text-[11px] tracking-wide">
                                {recommendationLabel(
                                  item.friend_recommendations_count,
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/books/${item.work_id}`}
                          className="line-clamp-2 block text-center font-heading text-lg font-semibold tracking-tight text-[var(--p-primary-color)] no-underline hover:underline"
                          data-test="library-item-title-link"
                        >
                          {item.work_title}
                        </Link>
                        {item.author_names?.length ? (
                          <p className="mt-0.5 truncate text-center text-sm text-[var(--p-text-muted-color)]">
                            {item.author_names.join(", ")}
                          </p>
                        ) : null}
                        {(visibleTags(item.tags, 2).length > 0 ||
                          remainingTagCount(item.tags, 2) > 0) && (
                          <div className="mt-1 flex flex-wrap justify-center gap-1">
                            {visibleTags(item.tags, 2).map((tag) => (
                              <div
                                key={`${item.id}-${tag}`}
                                className="library-meta-chip"
                              >
                                {tag}
                              </div>
                            ))}
                            {remainingTagCount(item.tags, 2) > 0 ? (
                              <div className="library-meta-chip">
                                +{remainingTagCount(item.tags, 2)}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                      <p
                        className="library-description mt-0.5 line-clamp-4 text-left text-sm text-[var(--p-text-muted-color)]"
                        data-test="library-item-description"
                        dangerouslySetInnerHTML={{
                          __html: renderDescriptionSnippet(
                            item.work_description,
                          ),
                        }}
                      />
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* Empty state */}
      {!loading && !displayItems.length ? (
        <div className="mt-4">
          <EmptyState
            data-test="library-empty"
            icon="pi pi-inbox"
            title="No library items found."
            body="Use the search bar in the top navigation to import books into your library."
          />
        </div>
      ) : null}

      {/* Pagination */}
      {pagination.total_count > 0 ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p
            className="text-sm text-[var(--p-text-muted-color)]"
            data-test="library-pagination-summary"
          >
            {pageRangeLabel} books
          </p>
          <div data-test="library-paginator">
            <Paginator
              first={Math.max(0, (page - 1) * pageSize)}
              rows={pageSize}
              totalRecords={pagination.total_count}
              rowsPerPageOptions={[10, 25, 50, 100]}
              onPageChange={(event) => {
                const nextPage = event.page + 1;
                const nextRows = event.rows;
                if (nextPage !== page || nextRows !== pageSize) {
                  setPage(nextPage);
                  setPageSize(nextRows);
                }
              }}
            />
          </div>
        </div>
      ) : null}

      {/* ─── Read Date Dialog ─── */}
      <Dialog
        visible={readDateOpen}
        onHide={() => {
          if (!readDateSaving) closeReadDatePrompt();
        }}
        className="w-full max-w-[40rem]"
        header={
          readDateDialogStatus === "reading"
            ? "Add reading start date"
            : "Add completion date"
        }
        modal
        draggable={false}
        data-test="library-read-date-dialog"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--p-text-muted-color)]">
            {readDateDialogStatus === "reading"
              ? "Add a start date for your current read, and optionally log previous completed reads."
              : "Add one or more completed reads, each with a start and finish date."}
          </p>
          {readDateFormError ? (
            <Message severity="error" text={readDateFormError} />
          ) : null}

          {readDateDialogStatus === "reading" ? (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <span className="self-center text-sm font-medium">
                  Current read start
                </span>
                <Calendar
                  value={readingCurrentStartDate}
                  onChange={(e) =>
                    setReadingCurrentStartDate(e.value as Date | null)
                  }
                  showIcon
                  maxDate={readDateMaxDate}
                  data-test="library-read-current-start"
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Previous completed reads
                </p>
                <Button
                  label="Add previous read"
                  icon="pi pi-plus"
                  size="small"
                  severity="secondary"
                  outlined
                  data-test="library-read-date-add-previous"
                  disabled={readDateSaving}
                  onClick={() =>
                    setPreviousReadEntries((prev) => [
                      ...prev,
                      buildReadDateEntry(),
                    ])
                  }
                />
              </div>
              {previousReadEntries.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {previousReadEntries.map((entry, index) => (
                    <div
                      key={entry.key}
                      className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--p-content-border-color)] p-3 sm:grid-cols-[1fr_auto]"
                    >
                      <Calendar
                        value={readDateRangeModel(entry)}
                        selectionMode="range"
                        showIcon
                        maxDate={readDateMaxDate}
                        data-test={`library-read-previous-range-${index}`}
                        onChange={(e) => {
                          const val = e.value;
                          setPreviousReadEntries((prev) =>
                            prev.map((ent) =>
                              ent.key === entry.key
                                ? {
                                    ...ent,
                                    startedAt: Array.isArray(val)
                                      ? (val[0] ?? null)
                                      : null,
                                    endedAt: Array.isArray(val)
                                      ? (val[1] ?? null)
                                      : null,
                                  }
                                : ent,
                            ),
                          );
                        }}
                      />
                      <Button
                        icon="pi pi-trash"
                        size="small"
                        severity="secondary"
                        text
                        className="sm:self-center"
                        aria-label={`Remove previous read ${index + 1}`}
                        disabled={readDateSaving}
                        onClick={() =>
                          setPreviousReadEntries((prev) =>
                            prev.filter((ent) => ent.key !== entry.key),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Completed reads</p>
                <Button
                  label="Add another read"
                  icon="pi pi-plus"
                  size="small"
                  severity="secondary"
                  outlined
                  data-test="library-read-date-add-completed"
                  disabled={readDateSaving}
                  onClick={() =>
                    setCompletedReadEntries((prev) => [
                      ...prev,
                      buildReadDateEntry(),
                    ])
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                {completedReadEntries.map((entry, index) => (
                  <div
                    key={entry.key}
                    className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--p-content-border-color)] p-3 sm:grid-cols-[1fr_auto]"
                  >
                    <Calendar
                      value={readDateRangeModel(entry)}
                      selectionMode="range"
                      showIcon
                      maxDate={readDateMaxDate}
                      data-test={`library-read-completed-range-${index}`}
                      onChange={(e) => {
                        const val = e.value;
                        setCompletedReadEntries((prev) =>
                          prev.map((ent) =>
                            ent.key === entry.key
                              ? {
                                  ...ent,
                                  startedAt: Array.isArray(val)
                                    ? (val[0] ?? null)
                                    : null,
                                  endedAt: Array.isArray(val)
                                    ? (val[1] ?? null)
                                    : null,
                                }
                              : ent,
                          ),
                        );
                      }}
                    />
                    {completedReadEntries.length > 1 ? (
                      <Button
                        icon="pi pi-trash"
                        size="small"
                        severity="secondary"
                        text
                        className="sm:self-center"
                        aria-label={`Remove completed read ${index + 1}`}
                        disabled={readDateSaving}
                        onClick={() =>
                          setCompletedReadEntries((prev) =>
                            prev.length <= 1
                              ? prev
                              : prev.filter((ent) => ent.key !== entry.key),
                          )
                        }
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              label={
                readDateDialogStatus === "reading"
                  ? "Start today and save"
                  : "Add today read and save"
              }
              severity="secondary"
              outlined
              data-test="library-read-date-today"
              loading={readDateSaving}
              disabled={readDateSaving}
              onClick={() => void saveReadDatePrompt(true)}
            />
            <Button
              label="Skip for now"
              severity="secondary"
              text
              data-test="library-read-date-skip"
              disabled={readDateSaving}
              onClick={closeReadDatePrompt}
            />
            <Button
              label={
                readDateDialogStatus === "reading"
                  ? "Save read history"
                  : "Save completed reads"
              }
              data-test="library-read-date-save"
              loading={readDateSaving}
              disabled={readDateSaving}
              onClick={() => void saveReadDatePrompt(false)}
            />
          </div>
        </div>
      </Dialog>

      {/* ─── Merge Dialog ─── */}
      <Dialog
        visible={mergeOpen}
        onHide={closeMergeDialog}
        className="w-full max-w-[44rem]"
        header="Merge books"
        modal
        draggable={false}
        data-test="library-merge-dialog"
      >
        <div className="flex flex-col gap-4">
          <Message severity="warn" text="This merge is irreversible. Source items will be removed after consolidation." />
          {mergeError ? (
            <Message severity="error" text={mergeError} />
          ) : null}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr] sm:items-center">
            <span className="text-sm font-medium">Merge into</span>
            <Dropdown
              value={mergeTargetId}
              options={selectedMergeItems.map((item) => ({
                label: item.work_title,
                value: item.id,
              }))}
              optionLabel="label"
              optionValue="value"
              data-test="library-merge-target-select"
              disabled={mergeLoading || mergeApplying}
              className="w-full"
              onChange={(event) => {
                const nextTarget = event.value as string;
                setMergeTargetId(nextTarget);
                void loadMergePreview(
                  nextTarget,
                  selectedMergeItems.map((i) => i.id),
                );
              }}
            />
          </div>

          {mergeLoading ? (
            <div className="grid gap-2" data-test="library-merge-loading">
              <Skeleton width="100%" height="3rem" />
              <Skeleton width="100%" height="3rem" />
              <Skeleton width="100%" height="3rem" />
            </div>
          ) : null}

          {!mergeLoading && mergePreview ? (
            <>
              {renderMergeFieldRow("status", "Status")}
              {renderMergeFieldRow("visibility", "Visibility")}
              {renderMergeFieldRow("rating", "Rating")}
              {renderMergeFieldRow("preferred_edition_id", "Preferred edition")}
              {renderMergeFieldRow("tags", "Tags")}

              <div
                className="rounded-lg border border-[var(--p-content-border-color)] p-3 text-sm"
                data-test="library-merge-summary"
              >
                <p className="font-semibold">
                  Dependent records moved from source items
                </p>
                <p className="text-[var(--p-text-muted-color)]">
                  Read cycles:{" "}
                  {mergePreview.dependencies?.totals_for_sources
                    ?.read_cycles ?? 0}{" "}
                  | Progress logs:{" "}
                  {mergePreview.dependencies?.totals_for_sources
                    ?.progress_logs ?? 0}{" "}
                  | Notes:{" "}
                  {mergePreview.dependencies?.totals_for_sources?.notes ?? 0}{" "}
                  | Highlights:{" "}
                  {mergePreview.dependencies?.totals_for_sources?.highlights ??
                    0}{" "}
                  | Reviews:{" "}
                  {mergePreview.dependencies?.totals_for_sources?.reviews ?? 0}
                </p>
              </div>
            </>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button
              label="Cancel"
              severity="secondary"
              text
              data-test="library-merge-cancel"
              disabled={mergeApplying}
              onClick={closeMergeDialog}
            />
            <Button
              label="Merge now"
              icon="pi pi-check"
              data-test="library-merge-apply"
              loading={mergeApplying}
              disabled={mergeLoading || !mergePreview || mergeApplying}
              onClick={() => void applyMerge()}
            />
          </div>
        </div>
      </Dialog>

      {/* ─── Remove Confirmation Dialog ─── */}
      <Dialog
        visible={pendingRemoveItem !== null}
        onHide={() => {
          if (!removeLoading) setPendingRemoveItem(null);
        }}
        className="w-full max-w-md"
        header="Remove from library"
        modal
        draggable={false}
        data-test="library-remove-dialog"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--p-text-muted-color)]">
            Remove &quot;{pendingRemoveItem?.work_title}&quot; from your
            library? This cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              label="Cancel"
              severity="secondary"
              text
              data-test="library-remove-cancel"
              disabled={removeLoading}
              onClick={() => setPendingRemoveItem(null)}
            />
            <Button
              label="Remove"
              severity="danger"
              data-test="library-remove-confirm"
              loading={removeLoading}
              onClick={() => void confirmRemove()}
            />
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
