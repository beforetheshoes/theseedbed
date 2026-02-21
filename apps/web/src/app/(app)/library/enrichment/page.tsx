"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { DataView } from "primereact/dataview";
import { Message } from "primereact/message";
import { ProgressBar } from "primereact/progressbar";
import { TabPanel, TabView } from "primereact/tabview";
import { Tag } from "primereact/tag";
import { SetCoverAndMetadataDialog } from "@/components/library/workflows/SetCoverAndMetadataDialog";
import type {
  CoverMetadataCompareField,
  ProviderSourceTile,
} from "@/components/library/workflows/SetCoverAndMetadataDialog";
import type { Edition } from "@/components/library/workflows/types";
import { ApiClientError, apiRequest } from "@/lib/api";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useAppToast } from "@/components/toast-provider";

type EnrichmentTask = {
  id: string;
  library_item_id: string;
  work_id: string;
  edition_id?: string | null;
  work_title?: string | null;
  status: string;
  confidence: string | null;
  missing_fields: string[];
  fields_applied: string[];
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  last_error: string | null;
  cover_url?: string | null;
  authors?: string[];
  first_publish_year?: number | null;
  publisher?: string | null;
  publish_date?: string | null;
  language?: string | null;
  format?: string | null;
  isbn10?: string | null;
  isbn13?: string | null;
  suggested_values?: Record<string, unknown>;
};

type EnrichResult = {
  queued: number;
  results: {
    processed: number;
    covers_applied: number;
    metadata_applied: number;
    needs_review: number;
    skipped: number;
    failed: number;
  };
};

type ProcessBatchResult = {
  processed: number;
  covers_applied: number;
  metadata_applied: number;
  needs_review: number;
  skipped: number;
  failed: number;
  limit: number;
};

type SourceLanguageProfile = {
  default_source_language?: string | null;
};

type CoverMetadataComparePayload = {
  fields: CoverMetadataCompareField[];
};

type CoverMetadataMode = "choose" | "upload" | "url";
type SelectionValue = "current" | "selected";

const FIELD_LABELS: Record<string, string> = {
  "work.cover_url": "Cover",
  "work.description": "Description",
  "work.first_publish_year": "First published",
  "edition.publisher": "Publisher",
  "edition.publish_date": "Publish date",
  "edition.isbn10": "ISBN-10",
  "edition.isbn13": "ISBN-13",
  "edition.language": "Language",
  "edition.format": "Format",
};
const SOURCE_LANGUAGE_OPTIONS = [
  { label: "English (eng)", value: "eng" },
  { label: "Spanish (spa)", value: "spa" },
  { label: "French (fra)", value: "fra" },
  { label: "German (deu)", value: "deu" },
  { label: "Italian (ita)", value: "ita" },
  { label: "Portuguese (por)", value: "por" },
  { label: "Dutch (nld)", value: "nld" },
  { label: "Japanese (jpn)", value: "jpn" },
  { label: "Korean (kor)", value: "kor" },
  { label: "Chinese (zho)", value: "zho" },
] as const;
const DEFAULT_SOURCE_LANGUAGE = "eng";

const STATUS_TABS = [
  {
    key: "needs_review",
    label: "Needs Review",
    icon: "pi pi-exclamation-circle",
  },
  { key: "pending", label: "Pending", icon: "pi pi-clock" },
  { key: "in_progress", label: "In Progress", icon: "pi pi-hourglass" },
  { key: "complete", label: "Complete", icon: "pi pi-check-circle" },
  { key: "skipped", label: "Skipped", icon: "pi pi-minus-circle" },
  { key: "failed", label: "Failed", icon: "pi pi-times-circle" },
] as const;

type StatusKey = (typeof STATUS_TABS)[number]["key"];

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/^(work|edition)\./, "");
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function formatSuggestedValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function hasSuggestedMetadata(task: EnrichmentTask): boolean {
  const suggested = task.suggested_values ?? {};
  return Boolean(
    formatSuggestedValue(suggested["edition.publisher"]) ||
      formatSuggestedValue(suggested["edition.publish_date"]) ||
      formatSuggestedValue(suggested["edition.language"]) ||
      formatSuggestedValue(suggested["edition.format"]) ||
      formatSuggestedValue(suggested["work.first_publish_year"]) ||
      formatSuggestedValue(suggested["edition.isbn13"]) ||
      formatSuggestedValue(suggested["edition.isbn10"]),
  );
}

function normalizeSourceLanguage(value: string | null | undefined): string {
  if (!value) return DEFAULT_SOURCE_LANGUAGE;
  const normalized = value.trim().toLowerCase();
  return /^[a-z]{2,3}$/.test(normalized) ? normalized : DEFAULT_SOURCE_LANGUAGE;
}

function statusInfo(status: string): {
  label: string;
  icon: string;
  severity: "success" | "info" | "warning" | "danger" | "secondary" | undefined;
} {
  switch (status) {
    case "complete":
      return {
        label: "Complete",
        icon: "pi pi-check-circle",
        severity: "success",
      };
    case "needs_review":
      return {
        label: "Needs Review",
        icon: "pi pi-exclamation-circle",
        severity: "warning",
      };
    case "pending":
      return { label: "Pending", icon: "pi pi-clock", severity: "info" };
    case "in_progress":
      return {
        label: "In Progress",
        icon: "pi pi-hourglass",
        severity: "info",
      };
    case "skipped":
      return {
        label: "Skipped",
        icon: "pi pi-minus-circle",
        severity: "secondary",
      };
    case "failed":
      return {
        label: "Failed",
        icon: "pi pi-times-circle",
        severity: "danger",
      };
    default:
      return {
        label: status,
        icon: "pi pi-question-circle",
        severity: "secondary",
      };
  }
}

function tabHeader(label: string, icon: string, count: number): ReactNode {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-base font-semibold">
      <i className={icon} />
      <span>
        {label} ({count})
      </span>
    </span>
  );
}

export default function LibraryEnrichmentPage() {
  const supabase = useMemo(() => createBrowserClient(), []);
  const toast = useAppToast();

  const [allTasks, setAllTasks] = useState<EnrichmentTask[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [lastResult, setLastResult] = useState<EnrichResult | null>(null);
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [hasBackgroundUpdates, setHasBackgroundUpdates] = useState(false);
  const [selectedNeedsReviewIds, setSelectedNeedsReviewIds] = useState<string[]>(
    [],
  );
  const [bulkActionBusy, setBulkActionBusy] = useState<"apply" | "retry" | null>(
    null,
  );
  const isRefreshingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const compareCacheRef = useRef<Map<string, CoverMetadataCompareField[]>>(
    new Map(),
  );

  const [defaultSourceLanguage, setDefaultSourceLanguage] = useState(
    DEFAULT_SOURCE_LANGUAGE,
  );
  const [coverMetadataMode, setCoverMetadataMode] =
    useState<CoverMetadataMode>("choose");
  const [sourceSearchTitle, setSourceSearchTitle] = useState("");
  const [sourceLanguages, setSourceLanguages] = useState<string[]>([
    DEFAULT_SOURCE_LANGUAGE,
  ]);
  const [sourceTiles, setSourceTiles] = useState<ProviderSourceTile[]>([]);
  const [sourceTilesLoading, setSourceTilesLoading] = useState(false);
  const [sourceTilesError, setSourceTilesError] = useState("");
  const [selectedSourceKey, setSelectedSourceKey] = useState("");
  const [compareFields, setCompareFields] = useState<CoverMetadataCompareField[]>(
    [],
  );
  const [compareSelection, setCompareSelection] = useState<
    Record<string, SelectionValue>
  >({});
  const [compareFieldsLoading, setCompareFieldsLoading] = useState(false);
  const [dialogTaskId, setDialogTaskId] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [dialogApplying, setDialogApplying] = useState(false);
  const [workflowEditions, setWorkflowEditions] = useState<Edition[]>([]);
  const [workflowEditionId, setWorkflowEditionId] = useState("");
  const [coverSourceUrl, setCoverSourceUrl] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverBusy] = useState(false);

  const refreshData = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (isRefreshingRef.current) {
      return;
    }
    isRefreshingRef.current = true;
    if (!silent) {
      setLoading(true);
    }
    try {
      const all: EnrichmentTask[] = [];
      let cursor: string | null = null;
      do {
        const query: Record<string, string | number> = { limit: 100 };
        if (cursor) query.cursor = cursor;
        const res = await apiRequest<{
          items: EnrichmentTask[];
          next_cursor: string | null;
        }>(supabase, "/api/v1/library/enrichment/tasks", { query });
        all.push(...(res.items ?? []));
        cursor = res.next_cursor ?? null;
      } while (cursor);
      setAllTasks(all);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to load enrichment data right now.",
      );
    } finally {
      isRefreshingRef.current = false;
      if (!silent) {
        setLoading(false);
      }
    }
  }, [supabase]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    let active = true;
    const loadSourceLanguagePreference = async () => {
      try {
        const profile = await apiRequest<SourceLanguageProfile>(
          supabase,
          "/api/v1/me",
        );
        if (!active) return;
        const normalized = normalizeSourceLanguage(
          profile.default_source_language,
        );
        setDefaultSourceLanguage(normalized);
        setSourceLanguages([normalized]);
      } catch {
        if (!active) return;
        setDefaultSourceLanguage(DEFAULT_SOURCE_LANGUAGE);
        setSourceLanguages([DEFAULT_SOURCE_LANGUAGE]);
      }
    };
    void loadSourceLanguagePreference();
    return () => {
      active = false;
    };
  }, [supabase]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<StatusKey, EnrichmentTask[]> = {
      needs_review: [],
      pending: [],
      in_progress: [],
      complete: [],
      skipped: [],
      failed: [],
    };
    allTasks.forEach((task) => {
      if (task.status in grouped) {
        grouped[task.status as StatusKey].push(task);
      }
    });
    return grouped;
  }, [allTasks]);

  const totalAll = allTasks.length;
  const needsReviewTasks = tasksByStatus.needs_review;
  const needsReviewTaskMap = useMemo(
    () => new Map(needsReviewTasks.map((task) => [task.id, task])),
    [needsReviewTasks],
  );
  const pendingCount = tasksByStatus.pending.length;
  const inProgressCount = tasksByStatus.in_progress.length;
  const completedCount = tasksByStatus.complete.length;
  const progressPct =
    totalAll > 0 ? Math.round((completedCount / totalAll) * 100) : 0;
  const allNeedsReviewSelected =
    needsReviewTasks.length > 0 &&
    selectedNeedsReviewIds.length === needsReviewTasks.length;
  const selectedNeedsReviewTasks = selectedNeedsReviewIds
    .map((id) => needsReviewTaskMap.get(id))
    .filter((task): task is EnrichmentTask => Boolean(task));
  const selectedNeedsReviewWithSuggestions = selectedNeedsReviewTasks.filter(
    hasSuggestedMetadata,
  );
  const dialogTask = useMemo(
    () => allTasks.find((task) => task.id === dialogTaskId) ?? null,
    [allTasks, dialogTaskId],
  );
  const canEditWorkflowEditionTarget =
    workflowEditions.length > 0 && Boolean(workflowEditionId);

  useEffect(() => {
    const validIds = new Set(needsReviewTasks.map((task) => task.id));
    setSelectedNeedsReviewIds((previous) =>
      previous.filter((id) => validIds.has(id)),
    );
  }, [needsReviewTasks]);

  const processBatch = useCallback(
    async ({ limit = 1, silent = false }: { limit?: number; silent?: boolean } = {}) => {
      if (isProcessingRef.current) {
        return;
      }
      isProcessingRef.current = true;
      if (!silent) {
        setEnriching(true);
        setError("");
        setLastResult(null);
      }
      try {
        const result = await apiRequest<ProcessBatchResult>(
          supabase,
          "/api/v1/library/enrichment/process",
          { method: "POST", body: { limit } },
        );

        if (result.processed > 0) {
          if (silent) {
            setHasBackgroundUpdates(true);
          } else {
            await refreshData({ silent: true });
          }
        }

        if (!silent) {
          setLastResult({ queued: 0, results: result });
        }
      } catch (err) {
        if (!silent) {
          setError(
            err instanceof ApiClientError
              ? err.message
              : "Unable to process enrichment right now.",
          );
        }
      } finally {
        isProcessingRef.current = false;
        if (!silent) {
          setEnriching(false);
        }
      }
    },
    [refreshData, supabase],
  );

  const runEnrichment = async () => {
    await processBatch({ limit: 10, silent: false });
  };

  useEffect(() => {
    if (loading || enriching || taskBusyId || bulkActionBusy || document.hidden) {
      return;
    }
    if (pendingCount + inProgressCount <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      void processBatch({ limit: 1, silent: true });
    }, 12000);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    bulkActionBusy,
    enriching,
    inProgressCount,
    loading,
    pendingCount,
    processBatch,
    taskBusyId,
  ]);

  useEffect(() => {
    if (loading || taskBusyId || bulkActionBusy || !hasBackgroundUpdates) {
      return;
    }
    const timer = window.setTimeout(() => {
      void refreshData({ silent: true });
      setHasBackgroundUpdates(false);
    }, 1500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [bulkActionBusy, hasBackgroundUpdates, loading, refreshData, taskBusyId]);

  const approveTask = async (taskId: string) => {
    setTaskBusyId(taskId);
    setError("");
    try {
      await apiRequest(
        supabase,
        `/api/v1/library/enrichment/${taskId}/approve`,
        {
          method: "POST",
          body: { selections: [] },
        },
      );
      toast.show({
        severity: "success",
        summary: "Applied",
        detail: "Enrichment applied successfully.",
      });
      await refreshData({ silent: true });
    } catch (err) {
      const detail =
        err instanceof ApiClientError
          ? err.message
          : "Unable to approve this item right now.";
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to approve this item right now.",
      );
      toast.show({
        severity: "error",
        summary: "Apply failed",
        detail,
      });
    } finally {
      setTaskBusyId(null);
    }
  };

  const dismissTask = async (taskId: string) => {
    setTaskBusyId(taskId);
    setError("");
    try {
      await apiRequest(
        supabase,
        `/api/v1/library/enrichment/${taskId}/dismiss`,
        {
          method: "POST",
        },
      );
      await refreshData({ silent: true });
    } catch (err) {
      const detail =
        err instanceof ApiClientError
          ? err.message
          : "Unable to dismiss this item right now.";
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to dismiss this item right now.",
      );
      toast.show({
        severity: "error",
        summary: "Skip failed",
        detail,
      });
    } finally {
      setTaskBusyId(null);
    }
  };

  const retryTask = async (taskId: string) => {
    setTaskBusyId(taskId);
    setError("");
    try {
      const result = await apiRequest<EnrichmentTask>(
        supabase,
        `/api/v1/library/enrichment/${taskId}/retry-now`,
        { method: "POST" },
      );
      if (result.status === "complete" && result.fields_applied.length > 0) {
        toast.show({
          severity: "success",
          summary: "Enriched",
          detail: `Applied: ${result.fields_applied.map(fieldLabel).join(", ")}`,
        });
      } else if (result.status === "needs_review") {
        toast.show({
          severity: "warn",
          summary: "Needs Review",
          detail: "Found possible matches. Please review this item.",
        });
      } else if (result.status === "skipped") {
        toast.show({
          severity: "info",
          summary: "No Matches",
          detail: "No matching data found from any provider.",
        });
      } else if (result.status === "failed") {
        toast.show({
          severity: "error",
          summary: "Failed",
          detail: "Could not process this item.",
        });
      } else if (
        result.status === "pending" ||
        result.status === "in_progress"
      ) {
        toast.show({
          severity: "info",
          summary: "Retry queued",
          detail:
            result.last_error && result.last_error.trim().length > 0
              ? result.last_error
              : "The item was queued and will process shortly.",
        });
      }
      await refreshData({ silent: true });
    } catch (err) {
      const detail =
        err instanceof ApiClientError
          ? err.message
          : "Unable to retry this item right now.";
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to retry this item right now.",
      );
      toast.show({
        severity: "error",
        summary: "Retry failed",
        detail,
      });
    } finally {
      setTaskBusyId(null);
    }
  };

  const applySelectedNeedsReview = async () => {
    if (selectedNeedsReviewIds.length === 0 || bulkActionBusy) {
      return;
    }
    setBulkActionBusy("apply");
    setError("");
    let appliedCount = 0;
    let failedCount = 0;
    const skippedCount =
      selectedNeedsReviewTasks.length - selectedNeedsReviewWithSuggestions.length;
    for (const task of selectedNeedsReviewWithSuggestions) {
      try {
        await apiRequest(supabase, `/api/v1/library/enrichment/${task.id}/approve`, {
          method: "POST",
          body: { selections: [] },
        });
        appliedCount += 1;
      } catch {
        failedCount += 1;
      }
    }
    await refreshData({ silent: true });
    setSelectedNeedsReviewIds([]);
    if (appliedCount > 0) {
      toast.show({
        severity: "success",
        summary: "Bulk apply complete",
        detail: `${appliedCount} item${appliedCount === 1 ? "" : "s"} applied.`,
      });
    }
    if (skippedCount > 0 || failedCount > 0) {
      toast.show({
        severity: failedCount > 0 ? "warn" : "info",
        summary: "Some items not applied",
        detail: `${skippedCount} without suggestions, ${failedCount} failed.`,
      });
    }
    setBulkActionBusy(null);
  };

  const retrySelectedNeedsReview = async () => {
    if (selectedNeedsReviewIds.length === 0 || bulkActionBusy) {
      return;
    }
    setBulkActionBusy("retry");
    setError("");
    let retriedCount = 0;
    let failedCount = 0;
    for (const task of selectedNeedsReviewTasks) {
      try {
        await apiRequest<EnrichmentTask>(
          supabase,
          `/api/v1/library/enrichment/${task.id}/retry`,
          { method: "POST" },
        );
        retriedCount += 1;
      } catch {
        failedCount += 1;
      }
    }
    await refreshData({ silent: true });
    setSelectedNeedsReviewIds([]);
    toast.show({
      severity: failedCount > 0 ? "warn" : "success",
      summary: "Bulk retry queued",
      detail: `${retriedCount} moved to pending, ${failedCount} failed.`,
    });
    setBulkActionBusy(null);
  };

  const applyCompareFields = useCallback((fields: CoverMetadataCompareField[]) => {
    setCompareFields(fields);
    const initial: Record<string, SelectionValue> = {};
    for (const field of fields) {
      initial[field.field_key] = field.selected_available ? "selected" : "current";
    }
    setCompareSelection(initial);
  }, []);

  const coverMetadataCacheKey = useCallback(
    (
      workId: string,
      provider: "openlibrary" | "googlebooks",
      sourceId: string,
      editionId?: string,
    ) => `${workId}|${provider}|${sourceId}|${editionId || ""}`,
    [],
  );

  const loadWorkflowEditions = useCallback(
    async (workId: string, preferredEditionId?: string | null): Promise<string> => {
      try {
        const payload = await apiRequest<{ items: Edition[] }>(
          supabase,
          `/api/v1/works/${workId}/editions`,
          { query: { limit: 50 } },
        );
        const items = payload.items ?? [];
        setWorkflowEditions(items);
        const selected =
          (preferredEditionId &&
          items.some((edition) => edition.id === preferredEditionId)
            ? preferredEditionId
            : items[0]?.id) ?? "";
        setWorkflowEditionId(selected);
        return selected;
      } catch (err) {
        setDialogError(
          err instanceof ApiClientError
            ? err.message
            : "Unable to load editions right now.",
        );
        setWorkflowEditions([]);
        setWorkflowEditionId("");
        return "";
      }
    },
    [supabase],
  );

  const loadCoverMetadataSources = useCallback(
    async (
      workId: string,
      languages: string[],
      editionId?: string,
      titleOverride?: string,
    ) => {
      setSourceTilesLoading(true);
      setSourceTilesError("");
      try {
        const normalizedLanguages = Array.from(
          new Set(
            languages
              .map((entry) => normalizeSourceLanguage(entry))
              .filter((entry) => Boolean(entry)),
          ),
        );
        const payload = await apiRequest<{
          items: ProviderSourceTile[];
          prefetch_compare?: Record<string, CoverMetadataComparePayload>;
        }>(supabase, `/api/v1/works/${workId}/cover-metadata/sources`, {
          query: {
            limit: 10,
            languages:
              normalizedLanguages.length > 0
                ? normalizedLanguages.join(",")
                : undefined,
            title: titleOverride?.trim() || undefined,
            include_prefetch_compare: "false",
          },
        });
        const items = payload.items ?? [];
        setSourceTiles(items);
        const prefetched = payload.prefetch_compare ?? {};
        for (const [sourceKey, comparePayload] of Object.entries(prefetched)) {
          const separator = sourceKey.indexOf(":");
          if (separator <= 0) continue;
          const provider = sourceKey.slice(
            0,
            separator,
          ) as ProviderSourceTile["provider"];
          const sourceId = sourceKey.slice(separator + 1);
          if (!sourceId || !Array.isArray(comparePayload?.fields)) continue;
          compareCacheRef.current.set(
            coverMetadataCacheKey(workId, provider, sourceId, editionId),
            comparePayload.fields,
          );
        }
      } catch (err) {
        setSourceTiles([]);
        setSourceTilesError(
          err instanceof ApiClientError
            ? err.message
            : "Unable to load source options.",
        );
      } finally {
        setSourceTilesLoading(false);
      }
    },
    [coverMetadataCacheKey, supabase],
  );

  const loadCoverMetadataComparison = useCallback(
    async (
      workId: string,
      provider: "openlibrary" | "googlebooks",
      sourceId: string,
      options?: {
        silent?: boolean;
        editionId?: string;
        openlibraryWorkKey?: string;
      },
    ) => {
      const cacheKey = coverMetadataCacheKey(
        workId,
        provider,
        sourceId,
        options?.editionId ?? workflowEditionId,
      );
      const cached = compareCacheRef.current.get(cacheKey);
      if (cached) {
        applyCompareFields(cached);
        return;
      }
      if (!options?.silent) setCompareFieldsLoading(true);
      try {
        const payload = await apiRequest<{ fields: CoverMetadataCompareField[] }>(
          supabase,
          `/api/v1/works/${workId}/cover-metadata/compare`,
          {
            query: {
              provider,
              source_id: sourceId,
              openlibrary_work_key:
                provider === "openlibrary"
                  ? options?.openlibraryWorkKey?.trim() || undefined
                  : undefined,
              edition_id: options?.editionId || workflowEditionId || undefined,
            },
          },
        );
        applyCompareFields(payload.fields ?? []);
      } catch (err) {
        setCompareFields([]);
        setCompareSelection({});
        setDialogError(
          err instanceof ApiClientError
            ? err.message
            : "Unable to load selected source comparison.",
        );
      } finally {
        if (!options?.silent) setCompareFieldsLoading(false);
      }
    },
    [applyCompareFields, coverMetadataCacheKey, supabase, workflowEditionId],
  );

  const selectSourceTile = async (tile: ProviderSourceTile) => {
    if (!dialogTask) return;
    setSelectedSourceKey(`${tile.provider}:${tile.source_id}`);
    setDialogError("");
    await loadCoverMetadataComparison(
      dialogTask.work_id,
      tile.provider,
      tile.source_id,
      {
        editionId: workflowEditionId,
        openlibraryWorkKey: tile.openlibrary_work_key ?? undefined,
      },
    );
  };

  const resetComparisonToCurrent = () => {
    setCompareSelection((current) => {
      const reset: Record<string, SelectionValue> = {};
      for (const key of Object.keys(current)) {
        reset[key] = "current";
      }
      return reset;
    });
  };

  const openChooseMatchDialog = async (task: EnrichmentTask) => {
    setDialogTaskId(task.id);
    setDialogError("");
    setCoverMetadataMode("choose");
    setCoverSourceUrl("");
    setCoverFile(null);
    setSourceTilesError("");
    setSourceTiles([]);
    setSelectedSourceKey("");
    setCompareFields([]);
    setCompareSelection({});
    const initialLanguages = [defaultSourceLanguage];
    setSourceLanguages(initialLanguages);
    setSourceSearchTitle(task.work_title ?? "");
    const selectedEditionId = await loadWorkflowEditions(task.work_id, task.edition_id);
    await loadCoverMetadataSources(
      task.work_id,
      initialLanguages,
      selectedEditionId,
      task.work_title ?? undefined,
    );
  };

  const closeChooseMatchDialog = () => {
    if (dialogApplying) return;
    setDialogTaskId(null);
    setDialogError("");
    setSourceTiles([]);
    setSelectedSourceKey("");
    setCompareFields([]);
    setCompareSelection({});
  };

  const applySelectedCoverMetadataForTask = async () => {
    if (!dialogTask) return;
    setDialogApplying(true);
    setDialogError("");
    try {
      const selections = compareFields
        .map((field) => {
          const selection = compareSelection[field.field_key] ?? "current";
          if (selection !== "selected" || !field.selected_available) {
            return null;
          }
          return {
            field_key: field.field_key,
            provider: field.provider,
            provider_id: field.provider_id,
            value: field.selected_value,
          };
        })
        .filter(Boolean);
      await apiRequest(
        supabase,
        `/api/v1/library/enrichment/${dialogTask.id}/approve`,
        {
          method: "POST",
          body: { selections },
        },
      );
      toast.show({
        severity: "success",
        summary: "Match applied",
        detail: "Selected cover/metadata match was applied.",
      });
      closeChooseMatchDialog();
      void refreshData({ silent: true });
    } catch (err) {
      setDialogError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to apply selected match.",
      );
    } finally {
      setDialogApplying(false);
    }
  };

  const renderTaskCard = (task: EnrichmentTask, tabKey: StatusKey) => {
    const isBusy = taskBusyId === task.id || bulkActionBusy !== null;
    const isNeedsReview = tabKey === "needs_review";
    const isSelected = selectedNeedsReviewIds.includes(task.id);
    const si = statusInfo(task.status);
    const authors = task.authors?.length
      ? task.authors.join(", ")
      : "Unknown author";
    const metadataSummary = [
      task.publisher ? `Publisher: ${task.publisher}` : null,
      task.publish_date ? `Published: ${formatDate(task.publish_date)}` : null,
      task.first_publish_year
        ? `First published: ${task.first_publish_year}`
        : null,
      task.language ? `Language: ${task.language}` : null,
      task.format ? `Format: ${task.format}` : null,
      task.isbn13
        ? `ISBN-13: ${task.isbn13}`
        : task.isbn10
          ? `ISBN-10: ${task.isbn10}`
          : null,
    ]
      .filter(Boolean)
      .join(" | ");
    const suggested = task.suggested_values ?? {};
    const suggestedPublisher = formatSuggestedValue(
      suggested["edition.publisher"],
    );
    const suggestedPublishDate = formatSuggestedValue(
      suggested["edition.publish_date"],
    );
    const suggestedLanguage = formatSuggestedValue(
      suggested["edition.language"],
    );
    const suggestedFormat = formatSuggestedValue(suggested["edition.format"]);
    const suggestedFirstPublish = formatSuggestedValue(
      suggested["work.first_publish_year"],
    );
    const suggestedIsbn =
      formatSuggestedValue(suggested["edition.isbn13"]) ??
      formatSuggestedValue(suggested["edition.isbn10"]);
    const hasAnySuggestedMetadata = hasSuggestedMetadata(task);

    return (
      <div
        key={task.id}
        className={`rounded-lg border border-[var(--p-content-border-color)] bg-[var(--p-content-background)] p-3 ${isBusy ? "opacity-60" : ""}`}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[32px_80px_minmax(0,1fr)_120px] sm:gap-4">
          <div className="flex items-start pt-1">
            {isNeedsReview ? (
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-[var(--p-primary-color)]"
                checked={isSelected}
                disabled={isBusy}
                aria-label={`Select ${task.work_title || "item"}`}
                onChange={(event) => {
                  setSelectedNeedsReviewIds((previous) => {
                    if (event.target.checked) {
                      if (previous.includes(task.id)) return previous;
                      return [...previous, task.id];
                    }
                    return previous.filter((id) => id !== task.id);
                  });
                }}
              />
            ) : null}
          </div>
          <div className="relative h-28 w-20 overflow-hidden rounded border border-[var(--p-content-border-color)] bg-[var(--surface-100)]">
            {task.cover_url ? (
              <Image
                src={task.cover_url}
                alt={task.work_title || "Book cover"}
                fill
                sizes="80px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-[var(--p-text-muted-color)]">
                No cover
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Tag
                value={si.label}
                icon={si.icon}
                severity={si.severity}
                className="text-xs"
              />
              {task.confidence ? (
                <Tag
                  value={`Confidence: ${task.confidence}`}
                  severity="secondary"
                  className="text-xs"
                />
              ) : null}
            </div>

            <Link
              href={`/books/${task.work_id}`}
              className="line-clamp-2 text-base font-semibold text-[var(--p-primary-color)] no-underline hover:underline"
            >
              {task.work_title || "Untitled work"}
            </Link>
            <p className="mt-1 text-sm text-[var(--p-text-muted-color)]">
              {authors}
            </p>

            {task.status === "needs_review" ? (
              hasAnySuggestedMetadata ? (
                <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-[var(--p-text-color)] sm:grid-cols-2">
                  <div>
                    <span className="font-medium">Publisher:</span>{" "}
                    {suggestedPublisher ?? "No suggestion"}
                  </div>
                  <div>
                    <span className="font-medium">Published:</span>{" "}
                    {suggestedPublishDate
                      ? formatDate(suggestedPublishDate)
                      : "No suggestion"}
                  </div>
                  <div>
                    <span className="font-medium">Language:</span>{" "}
                    {suggestedLanguage ?? "No suggestion"}
                  </div>
                  <div>
                    <span className="font-medium">Format:</span>{" "}
                    {suggestedFormat ?? "No suggestion"}
                  </div>
                  <div>
                    <span className="font-medium">First published:</span>{" "}
                    {suggestedFirstPublish ?? "No suggestion"}
                  </div>
                  <div>
                    <span className="font-medium">ISBN:</span>{" "}
                    {suggestedIsbn ?? "No suggestion"}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-[var(--p-text-muted-color)]">
                  No metadata suggestions are currently available for this item.
                </p>
              )
            ) : metadataSummary ? (
              <p className="mt-2 text-sm text-[var(--p-text-muted-color)]">
                {metadataSummary}
              </p>
            ) : null}

            <p className="mt-2 text-xs text-[var(--p-text-muted-color)]">
              {task.status === "complete" && task.fields_applied.length > 0
                ? `Applied: ${task.fields_applied.map(fieldLabel).join(", ")}`
                : task.status === "needs_review"
                  ? `Review fields: ${task.missing_fields.map(fieldLabel).join(", ")}`
                  : task.status === "pending" || task.status === "in_progress"
                    ? task.last_error
                      ? `${task.last_error}`
                      : `Missing: ${task.missing_fields.map(fieldLabel).join(", ")}`
                    : task.last_error || "No provider details available"}
              {task.finished_at
                ? ` · ${formatRelativeTime(task.finished_at)}`
                : ""}
            </p>
          </div>

          <div className="flex items-start justify-end gap-2 sm:flex-col sm:items-end">
            {task.status === "needs_review" ? (
              <>
                <Button
                  label="Choose match"
                  size="small"
                  outlined
                  severity="secondary"
                  className="w-28 justify-center"
                  disabled={isBusy}
                  onClick={() => void openChooseMatchDialog(task)}
                />
                <Button
                  label="Apply"
                  size="small"
                  className="w-28 justify-center"
                  loading={isBusy}
                  disabled={isBusy || !hasAnySuggestedMetadata}
                  tooltip={
                    !hasAnySuggestedMetadata
                      ? "No suggestions available to apply for this item."
                      : undefined
                  }
                  onClick={() => void approveTask(task.id)}
                />
                <Button
                  label="Skip"
                  size="small"
                  outlined
                  severity="secondary"
                  className="w-28 justify-center"
                  disabled={isBusy}
                  onClick={() => void dismissTask(task.id)}
                />
              </>
            ) : null}

            {(task.status === "skipped" ||
              task.status === "failed" ||
              (task.status === "needs_review" && !hasAnySuggestedMetadata)) &&
            !isBusy ? (
              <Button
                label="Retry"
                icon="pi pi-refresh"
                size="small"
                outlined
                className="w-28 justify-center"
                disabled={isBusy}
                onClick={() => void retryTask(task.id)}
              />
            ) : null}

            <Link href={`/books/${task.work_id}`} className="no-underline">
              <Button
                label="Open"
                size="small"
                outlined
                severity="secondary"
                className="w-28 justify-center"
              />
            </Link>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="mx-auto max-w-6xl px-4 py-6"
      data-test="library-enrichment-page"
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Metadata Enrichment
          </h1>
          <p className="mt-1 text-sm text-[var(--p-text-muted-color)]">
            Review and manage missing covers and book metadata in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/library" className="no-underline">
            <Button label="Back to Library" icon="pi pi-arrow-left" text />
          </Link>
          <Button
            label="Process Next Batch"
            icon="pi pi-sparkles"
            loading={enriching}
            disabled={enriching}
            onClick={() => void runEnrichment()}
          />
        </div>
      </div>

      {error ? (
        <Message className="mb-4 w-full" severity="error" text={error} />
      ) : null}

      {!loading && totalAll > 0 ? (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {STATUS_TABS.map((tab) => (
              <span key={tab.key}>
                <strong>{tasksByStatus[tab.key].length}</strong>{" "}
                {tab.label.toLowerCase()}
              </span>
            ))}
            <span className="ml-auto text-xs text-[var(--p-text-muted-color)]">
              {totalAll} total
            </span>
          </div>
          <ProgressBar
            className="mt-3"
            value={progressPct}
            showValue={false}
            style={{ height: "6px" }}
          />
        </Card>
      ) : null}

      {lastResult ? (
        <Card className="mb-4">
          <p className="mb-3 font-medium">Latest Batch Results</p>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>Processed: {lastResult.results.processed}</div>
            <div>Covers found: {lastResult.results.covers_applied}</div>
            <div>Metadata updated: {lastResult.results.metadata_applied}</div>
            <div>Needs review: {lastResult.results.needs_review}</div>
          </div>
        </Card>
      ) : null}

      {!loading && totalAll === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-[var(--p-text-muted-color)]">
            <i className="pi pi-sparkles mb-2 text-2xl" />
            <p>
              No enrichment tasks yet. Run a batch to find missing covers and
              metadata.
            </p>
          </div>
        </Card>
      ) : null}

      {!loading && totalAll > 0 ? (
        <TabView
          className="enrichment-tabview"
          activeIndex={activeIndex}
          renderActiveOnly
          onTabChange={(event) => setActiveIndex(event.index)}
        >
          {STATUS_TABS.map((tab) => {
            const tasks = tasksByStatus[tab.key];
            return (
              <TabPanel
                key={tab.key}
                header={tabHeader(tab.label, tab.icon, tasks.length)}
              >
                {tasks.length === 0 ? (
                  <Card>
                    <p className="text-sm text-[var(--p-text-muted-color)]">
                      No items in {tab.label.toLowerCase()}.
                    </p>
                  </Card>
                ) : (
                  <>
                    {tab.key === "needs_review" ? (
                      <Card className="mb-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            label={
                              allNeedsReviewSelected
                                ? "Clear selection"
                                : "Select all"
                            }
                            size="small"
                            outlined
                            disabled={bulkActionBusy !== null}
                            onClick={() =>
                              setSelectedNeedsReviewIds(
                                allNeedsReviewSelected
                                  ? []
                                  : needsReviewTasks.map((task) => task.id),
                              )
                            }
                          />
                          <Button
                            label="Apply all suggestions"
                            size="small"
                            disabled={
                              selectedNeedsReviewIds.length === 0 ||
                              selectedNeedsReviewWithSuggestions.length === 0 ||
                              bulkActionBusy !== null
                            }
                            loading={bulkActionBusy === "apply"}
                            onClick={() => void applySelectedNeedsReview()}
                          />
                          <Button
                            label="Retry enrichment"
                            size="small"
                            outlined
                            disabled={
                              selectedNeedsReviewIds.length === 0 ||
                              bulkActionBusy !== null
                            }
                            loading={bulkActionBusy === "retry"}
                            onClick={() => void retrySelectedNeedsReview()}
                          />
                          <span className="ml-auto text-sm text-[var(--p-text-muted-color)]">
                            {selectedNeedsReviewIds.length} selected
                          </span>
                        </div>
                      </Card>
                    ) : null}

                    <DataView
                      value={tasks}
                      itemTemplate={(item) =>
                        renderTaskCard(item as EnrichmentTask, tab.key)
                      }
                      paginator
                      rows={25}
                      rowsPerPageOptions={[25, 50, 100]}
                      className="enrichment-dataview"
                    />
                  </>
                )}
              </TabPanel>
            );
          })}
        </TabView>
      ) : null}

      <SetCoverAndMetadataDialog
        visible={dialogTask !== null}
        onHide={closeChooseMatchDialog}
        headerTitle={`Set cover and metadata${dialogTask ? ` · ${dialogTask.work_title ?? "Untitled work"}` : ""}`}
        workflowError={dialogError}
        mode={coverMetadataMode}
        loadingSources={sourceTilesLoading}
        sourceError={sourceTilesError}
        sourceSearchTitle={sourceSearchTitle}
        sourceLanguages={sourceLanguages}
        languageOptions={[...SOURCE_LANGUAGE_OPTIONS]}
        defaultSourceLanguage={defaultSourceLanguage}
        sourceTiles={sourceTiles}
        selectedSourceKey={selectedSourceKey}
        compareLoading={compareFieldsLoading}
        compareFields={compareFields}
        fieldSelection={compareSelection}
        enrichmentApplying={dialogApplying}
        coverBusy={coverBusy}
        workflowEditions={workflowEditions}
        workflowEditionId={workflowEditionId}
        coverSourceUrl={coverSourceUrl}
        hasSelectedFile={coverFile !== null}
        canEditEditionTarget={canEditWorkflowEditionTarget}
        onModeChange={setCoverMetadataMode}
        onSourceSearchTitleChange={setSourceSearchTitle}
        onSourceLanguagesChange={(values) => {
          const normalized = Array.from(
            new Set(
              values
                .map((value) => normalizeSourceLanguage(value))
                .filter((value) => Boolean(value)),
            ),
          );
          if (!normalized.includes(defaultSourceLanguage)) {
            normalized.unshift(defaultSourceLanguage);
          }
          setSourceLanguages(normalized);
        }}
        onRefreshSources={() =>
          dialogTask
            ? void loadCoverMetadataSources(
                dialogTask.work_id,
                sourceLanguages,
                workflowEditionId,
                sourceSearchTitle,
              )
            : undefined
        }
        onSelectSource={(tile) => void selectSourceTile(tile)}
        onResetAllToCurrent={resetComparisonToCurrent}
        onApplySelected={() => void applySelectedCoverMetadataForTask()}
        onFieldSelectionChange={(fieldKey, value) =>
          setCompareSelection((current) => ({
            ...current,
            [fieldKey]: value,
          }))
        }
        onFileChange={setCoverFile}
        onUploadCover={() => setDialogError("Upload mode is not available here.")}
        onCoverSourceUrlChange={setCoverSourceUrl}
        onCacheCover={() => setDialogError("URL mode is not available here.")}
      />
    </div>
  );
}
