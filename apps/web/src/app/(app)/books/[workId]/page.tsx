"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar } from "primereact/avatar";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Card } from "primereact/card";
import { Chart } from "primereact/chart";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { FileUpload, type FileUploadSelectEvent } from "primereact/fileupload";
import { InputText } from "primereact/inputtext";
import { Knob } from "primereact/knob";
import { Message } from "primereact/message";
import { Skeleton } from "primereact/skeleton";
import { Slider } from "primereact/slider";
import { Tag } from "primereact/tag";
import { Timeline } from "primereact/timeline";
import { InputTextarea } from "primereact/inputtextarea";
import { Rating } from "primereact/rating";
import { SelectButton } from "primereact/selectbutton";
import { ApiClientError, apiRequest } from "@/lib/api";
import { renderDescriptionHtml } from "@/lib/description";
import {
  canConvert,
  fromCanonicalPercent,
  toCanonicalPercent,
  type ProgressUnit,
} from "@/lib/progress-conversion";
import { createBrowserClient } from "@/lib/supabase/browser";
import { BookDiscoverySection } from "@/components/books/book-discovery-section";
import { CoverPlaceholder } from "@/components/cover-placeholder";
import { useAppToast } from "@/components/toast-provider";

type WorkDetail = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  total_pages?: number | null;
  total_audio_minutes?: number | null;
  authors?: Array<{ id: string; name: string }>;
};

type LibraryItem = {
  id: string;
  work_id: string;
  preferred_edition_id?: string | null;
  cover_url?: string | null;
  status: "to_read" | "reading" | "completed" | "abandoned";
  visibility: "private" | "public";
};

type ReadCycle = {
  id: string;
  started_at: string;
};

type ReadingSession = {
  id: string;
  logged_at: string;
  unit: ProgressUnit;
  value: number;
  note: string | null;
  canonical_percent?: number | null;
};

type Note = {
  id: string;
  title: string | null;
  body: string;
  visibility: "private" | "public" | string;
  created_at: string;
};

type Highlight = {
  id: string;
  quote: string;
  visibility: "private" | "public" | string;
  location_sort?: number | null;
  created_at: string;
};

type MeProfile = {
  default_progress_unit: ProgressUnit;
};

type BookStatistics = {
  totals?: {
    total_pages: number | null;
    total_audio_minutes: number | null;
  };
  current?: {
    pages_read?: number | null;
    canonical_percent?: number | null;
    minutes_listened?: number | null;
  };
  streak?: {
    non_zero_days: number;
  };
  timeline?: Array<{
    log_id: string;
    unit: ProgressUnit;
    logged_at: string;
    note?: string | null;
    start_value: number;
    end_value: number;
    session_delta: number;
  }>;
  data_quality?: {
    has_missing_totals: boolean;
    unresolved_logs_exist?: boolean;
  };
};

type Edition = {
  id: string;
  title?: string | null;
  format?: string | null;
};

type CoverCandidate = {
  source: "openlibrary" | "googlebooks" | string;
  source_url?: string | null;
  image_url?: string | null;
  cover_id?: number | null;
};

type EnrichmentCandidate = {
  provider: "openlibrary" | "googlebooks";
  provider_id: string;
  value: unknown;
  display_value: string;
  source_label: string;
};

type EnrichmentField = {
  field_key: string;
  current_value: string;
  candidates: EnrichmentCandidate[];
};

function resolveThemeColor(variableName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variableName)
    .trim();
  return value || fallback;
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("rgba(")) {
    const [r, g, b] = color
      .replace("rgba(", "")
      .replace(")", "")
      .split(",")
      .map((part) => Number(part.trim()));
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
      ? `rgba(${r}, ${g}, ${b}, ${alpha})`
      : color;
  }
  if (color.startsWith("rgb(")) {
    const [r, g, b] = color
      .replace("rgb(", "")
      .replace(")", "")
      .split(",")
      .map((part) => Number(part.trim()));
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
      ? `rgba(${r}, ${g}, ${b}, ${alpha})`
      : color;
  }
  const normalized = color.replace("#", "");
  const isHex = /^[0-9a-fA-F]{6}$/.test(normalized);
  if (!isHex) return color;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function BookDetailPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);
  const toast = useAppToast();

  const [workId, setWorkId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [libraryItem, setLibraryItem] = useState<LibraryItem | null>(null);
  const [bookStatistics, setBookStatistics] = useState<BookStatistics | null>(
    null,
  );
  const [statisticsLoading, setStatisticsLoading] = useState(false);

  const [editions, setEditions] = useState<Edition[]>([]);
  const [editionsLoading, setEditionsLoading] = useState(false);
  const [selectedEditionId, setSelectedEditionId] = useState<string>("");

  const [coverDialogOpen, setCoverDialogOpen] = useState(false);
  const [coverMode, setCoverMode] = useState<"choose" | "upload" | "url">(
    "choose",
  );
  const [coverCandidates, setCoverCandidates] = useState<CoverCandidate[]>([]);
  const [coverCandidatesLoading, setCoverCandidatesLoading] = useState(false);
  const [coverError, setCoverError] = useState("");
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverSourceUrl, setCoverSourceUrl] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);

  const [activeCycleId, setActiveCycleId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [sessionUnit, setSessionUnit] = useState<ProgressUnit>("pages_read");
  const [showConvertUnitSelect, setShowConvertUnitSelect] = useState(false);
  const [sessionValue, setSessionValue] = useState("");
  const [editingKnobValue, setEditingKnobValue] = useState(false);
  const [knobEditValue, setKnobEditValue] = useState("");
  const [pendingDecreaseValue, setPendingDecreaseValue] = useState<
    number | null
  >(null);
  const [progressChartMode, setProgressChartMode] = useState<
    "daily" | "cumulative"
  >("daily");
  const [progressChartUnit, setProgressChartUnit] =
    useState<ProgressUnit>("pages_read");
  const [sessionDate, setSessionDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [sessionNote, setSessionNote] = useState("");

  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteBody, setNewNoteBody] = useState("");
  const [newNoteVisibility, setNewNoteVisibility] = useState<
    "private" | "public"
  >("private");
  const [savingNote, setSavingNote] = useState(false);
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [editNoteTitle, setEditNoteTitle] = useState("");
  const [editNoteBody, setEditNoteBody] = useState("");
  const [editNoteVisibility, setEditNoteVisibility] = useState<
    "private" | "public"
  >("private");
  const [editingNote, setEditingNote] = useState(false);

  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [newHighlightQuote, setNewHighlightQuote] = useState("");
  const [newHighlightVisibility, setNewHighlightVisibility] = useState<
    "private" | "public"
  >("private");
  const [newHighlightSort, setNewHighlightSort] = useState("");
  const [savingHighlight, setSavingHighlight] = useState(false);
  const [editHighlightId, setEditHighlightId] = useState<string | null>(null);
  const [editHighlightQuote, setEditHighlightQuote] = useState("");
  const [editHighlightVisibility, setEditHighlightVisibility] = useState<
    "private" | "public"
  >("private");
  const [editHighlightSort, setEditHighlightSort] = useState("");
  const [editingHighlight, setEditingHighlight] = useState(false);

  const [reviewLoading, setReviewLoading] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [reviewVisibility, setReviewVisibility] = useState<
    "private" | "public"
  >("private");
  const [reviewRating, setReviewRating] = useState("");
  const [conversionError, setConversionError] = useState("");
  const [conversionMissing, setConversionMissing] = useState<
    Array<"total_pages" | "total_audio_minutes">
  >([]);
  const [pendingTargetUnit, setPendingTargetUnit] =
    useState<ProgressUnit | null>(null);
  const [showMissingTotalsForm, setShowMissingTotalsForm] = useState(false);
  const [loadingTotalsSuggestions, setLoadingTotalsSuggestions] =
    useState(false);
  const [totalPageSuggestions, setTotalPageSuggestions] = useState<number[]>(
    [],
  );
  const [totalTimeSuggestions, setTotalTimeSuggestions] = useState<number[]>(
    [],
  );
  const [pendingTotalPages, setPendingTotalPages] = useState("");
  const [pendingTotalAudio, setPendingTotalAudio] = useState("");
  const [savingTotals, setSavingTotals] = useState(false);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  const [enrichmentApplying, setEnrichmentApplying] = useState(false);
  const [enrichmentFields, setEnrichmentFields] = useState<EnrichmentField[]>(
    [],
  );
  const [enrichmentSelection, setEnrichmentSelection] = useState<
    Record<string, "keep" | "openlibrary" | "googlebooks">
  >({});

  const authorLabel = work?.authors?.map((author) => author.name).join(", ");
  const showActiveLogger = libraryItem?.status === "reading";
  const progressTotals = useMemo(
    () => ({
      total_pages:
        bookStatistics?.totals?.total_pages ?? work?.total_pages ?? null,
      total_audio_minutes:
        bookStatistics?.totals?.total_audio_minutes ??
        work?.total_audio_minutes ??
        null,
    }),
    [bookStatistics, work],
  );
  const lastLoggedValueForUnit = useMemo(() => {
    return sessions[0]?.value ?? null;
  }, [sessions]);
  const sessionSliderMax = useMemo(() => {
    if (sessionUnit === "percent_complete") return 100;
    if (sessionUnit === "pages_read") {
      return Math.max(progressTotals.total_pages ?? 1000, 1);
    }
    return Math.max(progressTotals.total_audio_minutes ?? 1440, 1);
  }, [
    progressTotals.total_audio_minutes,
    progressTotals.total_pages,
    sessionUnit,
  ]);
  const progressUnitOptions = useMemo(
    () =>
      [
        { label: "Pages", value: "pages_read" as const },
        { label: "Percent", value: "percent_complete" as const },
        { label: "Time", value: "minutes_listened" as const },
      ] satisfies Array<{ label: string; value: ProgressUnit }>,
    [],
  );
  const convertUnitOptions = useMemo(
    () =>
      progressUnitOptions.map((option) => ({
        ...option,
        disabled:
          option.value !== sessionUnit &&
          !canConvert(sessionUnit, option.value, progressTotals).canConvert,
      })),
    [progressTotals, progressUnitOptions, sessionUnit],
  );
  const ineligibleConvertUnits = useMemo(
    () =>
      progressUnitOptions
        .map((option) => option.value)
        .filter(
          (unit) =>
            unit !== sessionUnit &&
            !canConvert(sessionUnit, unit, progressTotals).canConvert,
        ),
    [progressTotals, progressUnitOptions, sessionUnit],
  );
  const formatDuration = (minutesValue: number): string => {
    const totalSeconds = Math.max(0, Math.round(minutesValue * 60));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };
  const formatProgressValue = (unit: ProgressUnit, value: number): string => {
    if (unit === "percent_complete") return `${Math.round(value)}%`;
    if (unit === "minutes_listened") return formatDuration(value);
    return String(Math.round(value));
  };
  const formatProgressDelta = (unit: ProgressUnit, value: number): string => {
    const formatted = formatProgressValue(unit, Math.abs(value));
    if (value < 0) return `-${formatted}`;
    if (value > 0) return `+${formatted}`;
    return formatted;
  };
  const formatDateOnly = (value: string): string =>
    new Date(value).toLocaleDateString();
  const resolveCanonicalFromLog = (session: ReadingSession): number => {
    if (typeof session.canonical_percent === "number") {
      return Math.max(0, Math.min(100, Math.round(session.canonical_percent)));
    }
    const canonical = toCanonicalPercent(
      session.unit,
      session.value,
      progressTotals,
    );
    return canonical === null
      ? 0
      : Math.max(0, Math.min(100, Math.round(canonical)));
  };
  const valueInUnitFromLog = (
    session: ReadingSession,
    unit: ProgressUnit,
  ): number => {
    if (session.unit === unit) return session.value;
    const canonical =
      typeof session.canonical_percent === "number"
        ? Math.max(0, Math.min(100, session.canonical_percent))
        : toCanonicalPercent(session.unit, session.value, progressTotals);
    if (canonical === null) return 0;
    if (unit === "percent_complete") return canonical;
    return fromCanonicalPercent(unit, canonical, progressTotals) ?? 0;
  };
  const latestSessionValueInUnit = (() => {
    const latest = sessions[0];
    if (!latest) return 0;
    return valueInUnitFromLog(latest, sessionUnit);
  })();
  const currentSessionNumeric = (() => {
    const raw = sessionValue.trim();
    if (!raw) return latestSessionValueInUnit;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return latestSessionValueInUnit;
    return parsed;
  })();
  const knobDisplayValue = formatProgressValue(
    sessionUnit,
    currentSessionNumeric,
  );
  const currentCanonicalPercent = (() => {
    const canonical = toCanonicalPercent(
      sessionUnit,
      currentSessionNumeric,
      progressTotals,
    );
    if (canonical !== null) return Math.round(canonical);
    return sessions[0] ? resolveCanonicalFromLog(sessions[0]) : 0;
  })();
  const displayPagesValue = (() => {
    if (bookStatistics?.current?.pages_read != null) {
      return Math.round(bookStatistics.current.pages_read);
    }
    const raw = sessionValue.trim();
    if (!raw) return 0;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return 0;
    if (sessionUnit === "pages_read") return Math.round(numeric);
    const canonical = toCanonicalPercent(sessionUnit, numeric, progressTotals);
    if (canonical === null) return 0;
    return Math.round(
      fromCanonicalPercent("pages_read", canonical, progressTotals) ?? 0,
    );
  })();
  const displayPercentValue = (() => {
    if (bookStatistics?.current?.canonical_percent != null) {
      return Math.round(bookStatistics.current.canonical_percent);
    }
    return Math.round(currentCanonicalPercent);
  })();
  const displayMinutesValue = (() => {
    if (bookStatistics?.current?.minutes_listened != null) {
      return Math.round(bookStatistics.current.minutes_listened);
    }
    const raw = sessionValue.trim();
    if (!raw) return 0;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return 0;
    if (sessionUnit === "minutes_listened") return Math.round(numeric);
    const canonical = toCanonicalPercent(sessionUnit, numeric, progressTotals);
    if (canonical === null) return 0;
    return Math.round(
      fromCanonicalPercent("minutes_listened", canonical, progressTotals) ?? 0,
    );
  })();
  const totalsTimeDisplay = formatDuration(
    progressTotals.total_audio_minutes ?? 0,
  );
  const streakDays = (() => {
    if (bookStatistics?.streak?.non_zero_days != null) {
      return bookStatistics.streak.non_zero_days;
    }
    const uniqueDays = new Set<string>();
    for (const session of sessions) {
      if (resolveCanonicalFromLog(session) <= 0) continue;
      uniqueDays.add(new Date(session.logged_at).toDateString());
    }
    return uniqueDays.size;
  })();
  const timelineSessions = (() => {
    if (bookStatistics?.timeline?.length) {
      return bookStatistics.timeline.map((entry) => ({
        id: entry.log_id,
        loggedAt: entry.logged_at,
        note: entry.note ?? null,
        sessionDelta: entry.session_delta,
        startDisplay: formatProgressValue(entry.unit, entry.start_value),
        endDisplay: formatProgressValue(entry.unit, entry.end_value),
        sessionDisplay: formatProgressDelta(entry.unit, entry.session_delta),
      }));
    }
    const chronological = [...sessions].sort(
      (left, right) =>
        new Date(left.logged_at).getTime() -
        new Date(right.logged_at).getTime(),
    );
    let previousCanonical = 0;
    return chronological
      .map((session) => {
        const endCanonical = resolveCanonicalFromLog(session);
        const startCanonical = previousCanonical;
        const startValue =
          fromCanonicalPercent(session.unit, startCanonical, progressTotals) ??
          0;
        const endValue =
          session.unit === "percent_complete" ? endCanonical : session.value;
        previousCanonical = endCanonical;
        return {
          id: session.id,
          loggedAt: session.logged_at,
          note: session.note,
          sessionDelta: endValue - startValue,
          startDisplay: formatProgressValue(session.unit, startValue),
          endDisplay: formatProgressValue(session.unit, endValue),
          sessionDisplay: formatProgressDelta(
            session.unit,
            endValue - startValue,
          ),
        };
      })
      .sort(
        (left, right) =>
          new Date(right.loggedAt).getTime() -
          new Date(left.loggedAt).getTime(),
      );
  })();
  const progressChartPoints = (() => {
    if (!sessions.length) return [];
    const chronological = [...sessions]
      .sort(
        (left, right) =>
          new Date(left.logged_at).getTime() -
          new Date(right.logged_at).getTime(),
      )
      .map((session) => {
        const canonical = resolveCanonicalFromLog(session);
        const value =
          progressChartUnit === "percent_complete"
            ? canonical
            : (fromCanonicalPercent(
                progressChartUnit,
                canonical,
                progressTotals,
              ) ?? 0);
        return {
          dateLabel: formatDateOnly(session.logged_at),
          value,
          loggedAt: session.logged_at,
        };
      });
    if (progressChartMode === "daily") {
      const byDay = new Map<string, number>();
      let previous = 0;
      for (const point of chronological) {
        const gain = Math.max(0, point.value - previous);
        byDay.set(point.dateLabel, (byDay.get(point.dateLabel) ?? 0) + gain);
        previous = point.value;
      }
      return Array.from(byDay.entries()).map(([dateLabel, value]) => ({
        dateLabel,
        value,
        loggedAt: dateLabel,
      }));
    }
    return chronological;
  })();
  const progressChartData = useMemo(() => {
    const primary = resolveThemeColor("--p-primary-color", "#3b82f6");
    return {
      labels: progressChartPoints.map((point) => point.dateLabel),
      datasets: [
        {
          label: progressChartMode === "daily" ? "Daily progress" : "Progress",
          data: progressChartPoints.map((point) => point.value),
          borderColor: primary,
          backgroundColor:
            progressChartMode === "daily"
              ? withAlpha(primary, 0.3)
              : withAlpha(primary, 0.1),
          tension: 0.35,
          fill: progressChartMode !== "daily",
        },
      ],
    };
  }, [progressChartMode, progressChartPoints]);
  const progressChartOptions = useMemo(() => {
    const muted = resolveThemeColor("--p-text-muted-color", "#64748b");
    const border = resolveThemeColor(
      "--p-content-border-color",
      "rgba(148, 163, 184, 0.5)",
    );
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { color: muted },
          grid: { color: border },
        },
        y: {
          beginAtZero: true,
          ticks: { color: muted },
          grid: { color: border },
        },
      },
    };
  }, []);

  useEffect(() => {
    if (!sessions.length) {
      setSessionValue("0");
      return;
    }
    const totals = {
      total_pages: progressTotals.total_pages,
      total_audio_minutes: progressTotals.total_audio_minutes,
    };
    const latest = sessions[0];
    const canonical =
      typeof latest.canonical_percent === "number"
        ? Math.max(0, Math.min(100, latest.canonical_percent))
        : toCanonicalPercent(latest.unit, latest.value, totals);
    const initial =
      latest.unit === sessionUnit
        ? latest.value
        : canonical === null
          ? 0
          : sessionUnit === "percent_complete"
            ? canonical
            : (fromCanonicalPercent(sessionUnit, canonical, totals) ?? 0);
    setSessionValue(String(Math.max(0, Math.round(initial))));
  }, [
    sessionUnit,
    sessions,
    progressTotals.total_audio_minutes,
    progressTotals.total_pages,
  ]);

  const requestUnitConversion = (targetUnit: ProgressUnit): boolean => {
    if (targetUnit === sessionUnit) {
      setConversionError("");
      setConversionMissing([]);
      setPendingTargetUnit(null);
      return true;
    }

    const capability = canConvert(sessionUnit, targetUnit, progressTotals);
    if (!capability.canConvert) {
      setConversionMissing(capability.missing);
      setPendingTargetUnit(targetUnit);
      setConversionError("Missing totals required for conversion.");
      setShowMissingTotalsForm(true);
      return false;
    }

    const numeric = currentSessionNumeric;
    const canonical = toCanonicalPercent(sessionUnit, numeric, progressTotals);
    if (canonical === null) {
      setConversionError("Unable to convert current progress value.");
      return false;
    }
    const converted = fromCanonicalPercent(
      targetUnit,
      canonical,
      progressTotals,
    );
    if (converted === null) {
      setConversionError("Unable to convert to selected unit.");
      return false;
    }

    setSessionUnit(targetUnit);
    setSessionValue(String(Math.max(0, Math.round(converted))));
    setConversionError("");
    setConversionMissing([]);
    setPendingTargetUnit(null);
    setShowMissingTotalsForm(false);
    return true;
  };

  const minutesToHms = (minutesValue: number): string => {
    const totalSeconds = Math.max(0, Math.round(minutesValue * 60));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const collectSuggestionValues = (
    fields: Array<{
      field_key: string;
      candidates?: Array<{ value?: unknown }>;
    }>,
    fieldKey: string,
  ): number[] => {
    const field = fields.find((entry) => entry.field_key === fieldKey);
    if (!field?.candidates?.length) return [];
    const values = field.candidates
      .map((candidate) => candidate.value)
      .map((value) => (typeof value === "number" ? value : Number(value)))
      .map((value) =>
        fieldKey === "edition.total_pages" ? Math.round(value) : value,
      )
      .filter((value) => Number.isFinite(value) && value > 0) as number[];
    return [...new Set(values)];
  };

  const loadTotalsSuggestions = useCallback(async () => {
    if (!workId || !conversionMissing.length) return;
    setLoadingTotalsSuggestions(true);
    try {
      const payload = await apiRequest<{
        fields: Array<{
          field_key: string;
          candidates?: Array<{ value?: unknown }>;
        }>;
      }>(supabase, `/api/v1/works/${workId}/enrichment/candidates`);
      const pageSuggestions = collectSuggestionValues(
        payload.fields,
        "edition.total_pages",
      );
      const timeSuggestions = collectSuggestionValues(
        payload.fields,
        "edition.total_audio_minutes",
      );
      setTotalPageSuggestions(pageSuggestions);
      setTotalTimeSuggestions(timeSuggestions);

      if (
        conversionMissing.includes("total_pages") &&
        !pendingTotalPages.trim() &&
        pageSuggestions.length
      ) {
        setPendingTotalPages(String(pageSuggestions[0]));
      }
      if (
        conversionMissing.includes("total_audio_minutes") &&
        !pendingTotalAudio.trim() &&
        timeSuggestions.length
      ) {
        setPendingTotalAudio(minutesToHms(timeSuggestions[0]));
      }
    } catch {
      setTotalPageSuggestions([]);
      setTotalTimeSuggestions([]);
    } finally {
      setLoadingTotalsSuggestions(false);
    }
  }, [
    conversionMissing,
    pendingTotalAudio,
    pendingTotalPages,
    supabase,
    workId,
  ]);

  const promptMissingTotalsFromIneligible = useCallback(() => {
    const required = new Set<"total_pages" | "total_audio_minutes">();
    for (const unit of ineligibleConvertUnits) {
      const capability = canConvert(sessionUnit, unit, progressTotals);
      for (const missing of capability.missing) {
        required.add(missing);
      }
    }
    const nextMissing = [...required];
    setConversionMissing(nextMissing);
    setShowMissingTotalsForm(true);
  }, [ineligibleConvertUnits, progressTotals, sessionUnit]);

  useEffect(() => {
    if (!showMissingTotalsForm) return;
    void loadTotalsSuggestions();
  }, [loadTotalsSuggestions, showMissingTotalsForm]);

  const loadNotes = useCallback(
    async (itemId: string) => {
      setNotesLoading(true);
      try {
        const payload = await apiRequest<{ items: Note[] }>(
          supabase,
          `/api/v1/library/items/${itemId}/notes`,
        );
        setNotes(payload.items);
      } catch (err) {
        setError(
          err instanceof ApiClientError ? err.message : "Unable to load notes.",
        );
      } finally {
        setNotesLoading(false);
      }
    },
    [supabase],
  );

  const loadHighlights = useCallback(
    async (itemId: string) => {
      setHighlightsLoading(true);
      try {
        const payload = await apiRequest<{ items: Highlight[] }>(
          supabase,
          `/api/v1/library/items/${itemId}/highlights`,
        );
        setHighlights(payload.items);
      } catch (err) {
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Unable to load highlights.",
        );
      } finally {
        setHighlightsLoading(false);
      }
    },
    [supabase],
  );

  const loadSessions = useCallback(
    async (itemId: string) => {
      setSessionsLoading(true);
      setSessionsError("");
      try {
        const cycles = await apiRequest<{ items: ReadCycle[] }>(
          supabase,
          `/api/v1/library/items/${itemId}/read-cycles`,
          { query: { limit: 1 } },
        );
        const cycle = cycles.items[0] ?? null;
        setActiveCycleId(cycle?.id ?? null);
        if (!cycle) {
          setSessions([]);
          return;
        }
        const payload = await apiRequest<{ items: ReadingSession[] }>(
          supabase,
          `/api/v1/read-cycles/${cycle.id}/progress-logs`,
          { query: { limit: 200 } },
        );
        const sorted = [...payload.items].sort((left, right) => {
          const leftDay = new Date(left.logged_at).getTime();
          const rightDay = new Date(right.logged_at).getTime();
          if (rightDay !== leftDay) return rightDay - leftDay;
          return right.value - left.value;
        });
        setSessions(sorted);
      } catch (err) {
        setSessionsError(
          err instanceof ApiClientError
            ? err.message
            : "Unable to load sessions.",
        );
      } finally {
        setSessionsLoading(false);
      }
    },
    [supabase],
  );

  const loadReview = useCallback(
    async (workKey: string) => {
      setReviewLoading(true);
      try {
        const myReviews = await apiRequest<{
          items: Array<Record<string, unknown>>;
        }>(supabase, "/api/v1/me/reviews");
        const existing = myReviews.items.find(
          (entry) => entry.work_id === workKey,
        );
        if (existing) {
          setReviewTitle((existing.title as string | null) ?? "");
          setReviewBody((existing.body as string | null) ?? "");
          setReviewVisibility(
            ((existing.visibility as string | null) ?? "private") === "public"
              ? "public"
              : "private",
          );
          setReviewRating(
            typeof existing.rating === "number" ? String(existing.rating) : "",
          );
        } else {
          setReviewTitle("");
          setReviewBody("");
          setReviewVisibility("private");
          setReviewRating("");
        }
      } catch (err) {
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Unable to load review.",
        );
      } finally {
        setReviewLoading(false);
      }
    },
    [supabase],
  );

  const loadStatistics = useCallback(
    async (itemId: string) => {
      setStatisticsLoading(true);
      try {
        const payload = await apiRequest<BookStatistics>(
          supabase,
          `/api/v1/library/items/${itemId}/statistics`,
        );
        setBookStatistics(payload);
      } catch (err) {
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Unable to load reading statistics.",
        );
      } finally {
        setStatisticsLoading(false);
      }
    },
    [supabase],
  );

  const loadEditions = useCallback(
    async (currentWorkId: string, preferredEditionId?: string | null) => {
      setEditionsLoading(true);
      try {
        const payload = await apiRequest<{ items: Edition[] }>(
          supabase,
          `/api/v1/works/${currentWorkId}/editions`,
          { query: { limit: 50 } },
        );
        setEditions(payload.items);
        if (preferredEditionId) {
          setSelectedEditionId(preferredEditionId);
        } else {
          setSelectedEditionId(payload.items[0]?.id ?? "");
        }
      } catch (err) {
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Unable to load editions.",
        );
      } finally {
        setEditionsLoading(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const resolved = await params;
        if (!active) return;
        setWorkId(resolved.workId);

        const me = await apiRequest<MeProfile>(supabase, "/api/v1/me");
        if (!active) return;
        setSessionUnit(me.default_progress_unit ?? "pages_read");

        const nextWork = await apiRequest<WorkDetail>(
          supabase,
          `/api/v1/works/${resolved.workId}`,
        );
        if (!active) return;
        setWork(nextWork);

        let nextLibraryItem: LibraryItem | null = null;
        try {
          nextLibraryItem = await apiRequest<LibraryItem>(
            supabase,
            `/api/v1/library/items/by-work/${resolved.workId}`,
          );
        } catch (err) {
          if (
            !(err instanceof ApiClientError) ||
            typeof err.status !== "number" ||
            err.status !== 404
          ) {
            throw err;
          }
        }
        if (!active) return;
        setLibraryItem(nextLibraryItem);
        setSessionsError("");
        await loadEditions(
          resolved.workId,
          nextLibraryItem?.preferred_edition_id,
        );
        if (!nextLibraryItem) {
          setSessions([]);
          setNotes([]);
          setHighlights([]);
          setBookStatistics(null);
          return;
        }
        await Promise.all([
          loadSessions(nextLibraryItem.id),
          loadNotes(nextLibraryItem.id),
          loadHighlights(nextLibraryItem.id),
          loadReview(resolved.workId),
          loadStatistics(nextLibraryItem.id),
        ]);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Unable to load book details right now.",
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [
    loadEditions,
    loadHighlights,
    loadNotes,
    loadReview,
    loadSessions,
    loadStatistics,
    params,
    supabase,
  ]);

  const onStatusSelected = async (
    nextStatus: "to_read" | "reading" | "completed" | "abandoned",
  ) => {
    if (!libraryItem || savingStatus) return;
    if (libraryItem.status === nextStatus) return;

    setSavingStatus(true);
    setError("");
    try {
      await apiRequest<unknown>(
        supabase,
        `/api/v1/library/items/${libraryItem.id}`,
        { method: "PATCH", body: { status: nextStatus } },
      );
      setLibraryItem((current) =>
        current ? { ...current, status: nextStatus } : current,
      );
      toast.show({
        severity: "success",
        summary: "Status updated.",
        life: 2200,
      });
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : "Unable to update status.";
      toast.show({ severity: "error", summary: msg, life: 3000 });
      setError(msg);
    } finally {
      setSavingStatus(false);
    }
  };

  const removeFromLibrary = async () => {
    if (!libraryItem || removing) return;

    setRemoving(true);
    setError("");
    try {
      await apiRequest<unknown>(
        supabase,
        `/api/v1/library/items/${libraryItem.id}`,
        { method: "DELETE" },
      );
      toast.show({
        severity: "success",
        summary: "Removed from your library.",
        life: 2500,
      });
      router.push("/library");
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        toast.show({
          severity: "info",
          summary: "This item was already removed. Refreshing...",
          life: 2500,
        });
        router.push("/library");
      } else {
        const msg =
          err instanceof ApiClientError
            ? err.message
            : "Unable to remove this item right now.";
        toast.show({ severity: "error", summary: msg, life: 3000 });
        setError(msg);
        setRemoving(false);
      }
    }
  };

  const ensureActiveCycle = async (): Promise<string> => {
    if (!libraryItem) {
      throw new ApiClientError(
        "Library item not found.",
        "library_missing",
        404,
      );
    }
    if (activeCycleId) return activeCycleId;
    const created = await apiRequest<{ id: string }>(
      supabase,
      `/api/v1/library/items/${libraryItem.id}/read-cycles`,
      {
        method: "POST",
        body: { started_at: new Date().toISOString() },
      },
    );
    setActiveCycleId(created.id);
    return created.id;
  };

  const submitSessionLog = async (numeric: number) => {
    if (!libraryItem) return;
    setSavingSession(true);
    setError("");
    try {
      const cycleId = await ensureActiveCycle();
      const loggedAt = new Date(`${sessionDate}T12:00:00.000Z`).toISOString();
      await apiRequest<unknown>(
        supabase,
        `/api/v1/read-cycles/${cycleId}/progress-logs`,
        {
          method: "POST",
          body: {
            unit: sessionUnit,
            value:
              sessionUnit === "percent_complete"
                ? Math.min(100, numeric)
                : numeric,
            logged_at: loggedAt,
            note: sessionNote.trim() || null,
          },
        },
      );
      setSessionNote("");
      setSessionValue(String(Math.max(0, Math.round(numeric))));
      await loadSessions(libraryItem.id);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Unable to log session.",
      );
    } finally {
      setSavingSession(false);
    }
  };

  const confirmDecreaseAndLog = async () => {
    if (pendingDecreaseValue === null) return;
    const nextValue = pendingDecreaseValue;
    setPendingDecreaseValue(null);
    await submitSessionLog(nextValue);
  };

  const logSession = async () => {
    if (!libraryItem) return;
    const numeric = currentSessionNumeric;
    if (!Number.isFinite(numeric) || numeric < 0) {
      setError("Enter a valid progress value.");
      return;
    }
    if (!sessionDate) {
      setError("Select a session date.");
      return;
    }
    if (
      lastLoggedValueForUnit !== null &&
      numeric < lastLoggedValueForUnit &&
      pendingDecreaseValue === null
    ) {
      setPendingDecreaseValue(numeric);
      return;
    }
    await submitSessionLog(numeric);
  };

  const addNote = async () => {
    if (!libraryItem || !newNoteBody.trim()) return;
    setSavingNote(true);
    setError("");
    try {
      await apiRequest<unknown>(
        supabase,
        `/api/v1/library/items/${libraryItem.id}/notes`,
        {
          method: "POST",
          body: {
            title: newNoteTitle.trim() || null,
            body: newNoteBody,
            visibility: newNoteVisibility,
          },
        },
      );
      setNewNoteTitle("");
      setNewNoteBody("");
      await loadNotes(libraryItem.id);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Unable to add note.",
      );
    } finally {
      setSavingNote(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    setError("");
    try {
      await apiRequest<unknown>(supabase, `/api/v1/notes/${noteId}`, {
        method: "DELETE",
      });
      setNotes((current) => current.filter((note) => note.id !== noteId));
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Unable to delete note.",
      );
    }
  };

  const startEditNote = (note: Note) => {
    setEditNoteId(note.id);
    setEditNoteTitle(note.title ?? "");
    setEditNoteBody(note.body);
    setEditNoteVisibility(note.visibility === "public" ? "public" : "private");
  };

  const saveEditedNote = async () => {
    if (!libraryItem || !editNoteId) return;
    setEditingNote(true);
    setError("");
    try {
      await apiRequest<unknown>(supabase, `/api/v1/notes/${editNoteId}`, {
        method: "PATCH",
        body: {
          title: editNoteTitle.trim() || null,
          body: editNoteBody,
          visibility: editNoteVisibility,
        },
      });
      await loadNotes(libraryItem.id);
      setEditNoteId(null);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Unable to update note.",
      );
    } finally {
      setEditingNote(false);
    }
  };

  const addHighlight = async () => {
    if (!libraryItem || !newHighlightQuote.trim()) return;
    setSavingHighlight(true);
    setError("");
    try {
      const sort = newHighlightSort.trim();
      await apiRequest<unknown>(
        supabase,
        `/api/v1/library/items/${libraryItem.id}/highlights`,
        {
          method: "POST",
          body: {
            quote: newHighlightQuote,
            visibility: newHighlightVisibility,
            location_sort: sort ? Number(sort) : null,
          },
        },
      );
      setNewHighlightQuote("");
      setNewHighlightSort("");
      await loadHighlights(libraryItem.id);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to add highlight.",
      );
    } finally {
      setSavingHighlight(false);
    }
  };

  const deleteHighlight = async (highlightId: string) => {
    setError("");
    try {
      await apiRequest<unknown>(supabase, `/api/v1/highlights/${highlightId}`, {
        method: "DELETE",
      });
      setHighlights((current) =>
        current.filter((highlight) => highlight.id !== highlightId),
      );
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to delete highlight.",
      );
    }
  };

  const startEditHighlight = (highlight: Highlight) => {
    setEditHighlightId(highlight.id);
    setEditHighlightQuote(highlight.quote);
    setEditHighlightVisibility(
      highlight.visibility === "public" ? "public" : "private",
    );
    setEditHighlightSort(
      typeof highlight.location_sort === "number"
        ? String(highlight.location_sort)
        : "",
    );
  };

  const saveEditedHighlight = async () => {
    if (!libraryItem || !editHighlightId) return;
    setEditingHighlight(true);
    setError("");
    try {
      const sort = editHighlightSort.trim();
      await apiRequest<unknown>(
        supabase,
        `/api/v1/highlights/${editHighlightId}`,
        {
          method: "PATCH",
          body: {
            quote: editHighlightQuote,
            visibility: editHighlightVisibility,
            location_sort: sort ? Number(sort) : null,
          },
        },
      );
      await loadHighlights(libraryItem.id);
      setEditHighlightId(null);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to update highlight.",
      );
    } finally {
      setEditingHighlight(false);
    }
  };

  const setPreferredEdition = async (editionId: string) => {
    if (!libraryItem || !editionId) return;
    setError("");
    try {
      await apiRequest<unknown>(
        supabase,
        `/api/v1/library/items/${libraryItem.id}`,
        {
          method: "PATCH",
          body: { preferred_edition_id: editionId },
        },
      );
      const refreshed = await apiRequest<LibraryItem>(
        supabase,
        `/api/v1/library/items/by-work/${workId}`,
      );
      setLibraryItem(refreshed);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to set preferred edition.",
      );
    }
  };

  const loadCoverCandidates = async () => {
    if (!workId) return;
    setCoverCandidatesLoading(true);
    setCoverError("");
    try {
      const payload = await apiRequest<{ items: CoverCandidate[] }>(
        supabase,
        `/api/v1/works/${workId}/covers`,
        { query: { limit: 30 } },
      );
      setCoverCandidates(payload.items ?? []);
    } catch (err) {
      setCoverError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to load cover candidates.",
      );
      setCoverCandidates([]);
    } finally {
      setCoverCandidatesLoading(false);
    }
  };

  const openCoverDialog = async () => {
    setCoverDialogOpen(true);
    setCoverMode("choose");
    setCoverFile(null);
    setCoverSourceUrl("");
    await loadCoverCandidates();
  };

  const selectCoverCandidate = async (candidate: CoverCandidate) => {
    if (!workId) return;
    setCoverBusy(true);
    setCoverError("");
    try {
      const body =
        candidate.source === "openlibrary" &&
        typeof candidate.cover_id === "number"
          ? { cover_id: candidate.cover_id }
          : { source_url: candidate.source_url || candidate.image_url };
      await apiRequest<unknown>(
        supabase,
        `/api/v1/works/${workId}/covers/select`,
        {
          method: "POST",
          body,
        },
      );
      const refreshed = await apiRequest<WorkDetail>(
        supabase,
        `/api/v1/works/${workId}`,
      );
      setWork(refreshed);
      setCoverDialogOpen(false);
    } catch (err) {
      setCoverError(
        err instanceof ApiClientError ? err.message : "Unable to set cover.",
      );
    } finally {
      setCoverBusy(false);
    }
  };

  const uploadCover = async () => {
    if (!selectedEditionId || !coverFile || !workId) return;
    setCoverBusy(true);
    setCoverError("");
    try {
      const fd = new FormData();
      fd.append("file", coverFile);
      await apiRequest<unknown>(
        supabase,
        `/api/v1/editions/${selectedEditionId}/cover`,
        {
          method: "POST",
          body: fd,
        },
      );
      await setPreferredEdition(selectedEditionId);
      const refreshed = await apiRequest<WorkDetail>(
        supabase,
        `/api/v1/works/${workId}`,
      );
      setWork(refreshed);
      setCoverDialogOpen(false);
    } catch (err) {
      setCoverError(
        err instanceof ApiClientError ? err.message : "Unable to upload cover.",
      );
    } finally {
      setCoverBusy(false);
    }
  };

  const cacheCover = async () => {
    if (!selectedEditionId || !coverSourceUrl.trim() || !workId) return;
    setCoverBusy(true);
    setCoverError("");
    try {
      await apiRequest<unknown>(
        supabase,
        `/api/v1/editions/${selectedEditionId}/cover/cache`,
        {
          method: "POST",
          body: { source_url: coverSourceUrl.trim() },
        },
      );
      await setPreferredEdition(selectedEditionId);
      const refreshed = await apiRequest<WorkDetail>(
        supabase,
        `/api/v1/works/${workId}`,
      );
      setWork(refreshed);
      setCoverDialogOpen(false);
    } catch (err) {
      setCoverError(
        err instanceof ApiClientError ? err.message : "Unable to cache cover.",
      );
    } finally {
      setCoverBusy(false);
    }
  };

  const loadEnrichmentCandidates = async () => {
    if (!workId) return;
    setEnrichmentLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ fields: EnrichmentField[] }>(
        supabase,
        `/api/v1/works/${workId}/enrichment/candidates`,
      );
      setEnrichmentFields(payload.fields ?? []);
      const initial: Record<string, "keep" | "openlibrary" | "googlebooks"> =
        {};
      for (const field of payload.fields ?? []) {
        initial[field.field_key] = "keep";
      }
      setEnrichmentSelection(initial);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to load enrichment candidates.",
      );
    } finally {
      setEnrichmentLoading(false);
    }
  };

  const applyEnrichmentSelections = async () => {
    if (!workId) return;
    setEnrichmentApplying(true);
    setError("");
    try {
      const selections = enrichmentFields
        .map((field) => {
          const provider = enrichmentSelection[field.field_key] ?? "keep";
          if (provider === "keep") return null;
          const selected = field.candidates.find(
            (candidate) => candidate.provider === provider,
          );
          if (!selected) return null;
          return {
            field_key: field.field_key,
            provider: selected.provider,
            provider_id: selected.provider_id,
            value: selected.value,
          };
        })
        .filter(Boolean);
      await apiRequest<unknown>(
        supabase,
        `/api/v1/works/${workId}/enrichment/apply`,
        {
          method: "POST",
          body: {
            edition_id: selectedEditionId || null,
            selections,
          },
        },
      );
      const refreshed = await apiRequest<WorkDetail>(
        supabase,
        `/api/v1/works/${workId}`,
      );
      setWork(refreshed);
      await loadEnrichmentCandidates();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to apply enrichment selections.",
      );
    } finally {
      setEnrichmentApplying(false);
    }
  };

  const resolveTotalsEditionId = async (): Promise<string> => {
    if (selectedEditionId) return selectedEditionId;
    if (libraryItem?.preferred_edition_id)
      return libraryItem.preferred_edition_id;
    if (editions[0]?.id) return editions[0].id;

    if (!workId) {
      throw new ApiClientError("No work selected.", "work_missing", 404);
    }
    const payload = await apiRequest<{ items: Array<{ id: string }> }>(
      supabase,
      `/api/v1/works/${workId}/editions`,
      { query: { limit: 1 } },
    );
    const fallbackEditionId = payload.items[0]?.id;
    if (!fallbackEditionId) {
      throw new ApiClientError(
        "No edition available to update totals.",
        "edition_missing",
        404,
      );
    }
    setSelectedEditionId(fallbackEditionId);
    return fallbackEditionId;
  };

  const saveMissingTotals = async () => {
    setSavingTotals(true);
    setError("");
    try {
      const updates: Record<string, number> = {};

      const pagesRaw = pendingTotalPages.trim();
      if (pagesRaw) {
        if (!/^\d+$/.test(pagesRaw)) {
          throw new ApiClientError(
            "Total pages must be at least 1.",
            "invalid_total_pages",
            400,
          );
        }
        const parsedPages = Number(pagesRaw);
        if (!Number.isFinite(parsedPages) || parsedPages < 1) {
          throw new ApiClientError(
            "Total pages must be at least 1.",
            "invalid_total_pages",
            400,
          );
        }
        updates.total_pages = parsedPages;
      }

      const audioRaw = pendingTotalAudio.trim();
      if (audioRaw) {
        const timeMatch = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(audioRaw);
        if (!timeMatch) {
          throw new ApiClientError(
            "Total time must use hh:mm:ss.",
            "invalid_total_audio_minutes",
            400,
          );
        }
        const hours = Number(timeMatch[1]);
        const minutes = Number(timeMatch[2]);
        const seconds = Number(timeMatch[3]);
        const totalSeconds = hours * 3600 + minutes * 60 + seconds;
        if (totalSeconds <= 0) {
          throw new ApiClientError(
            "Total time must be greater than 0.",
            "invalid_total_audio_minutes",
            400,
          );
        }
        updates.total_audio_minutes = Math.max(
          1,
          Math.round(totalSeconds / 60),
        );
      }

      if (!Object.keys(updates).length) {
        throw new ApiClientError(
          "Enter at least one total value.",
          "missing_totals",
          400,
        );
      }

      const editionId = await resolveTotalsEditionId();
      const updated = await apiRequest<{
        total_pages: number | null;
        total_audio_minutes: number | null;
      }>(supabase, `/api/v1/editions/${editionId}/totals`, {
        method: "PATCH",
        body: updates,
      });

      setWork((current) =>
        current
          ? {
              ...current,
              total_pages: updated.total_pages,
              total_audio_minutes: updated.total_audio_minutes,
            }
          : current,
      );
      setBookStatistics((current) =>
        current
          ? {
              ...current,
              totals: {
                total_pages: updated.total_pages,
                total_audio_minutes: updated.total_audio_minutes,
              },
              data_quality: current.data_quality
                ? { ...current.data_quality, has_missing_totals: false }
                : current.data_quality,
            }
          : current,
      );
      setPendingTotalPages("");
      setPendingTotalAudio("");
      setConversionMissing([]);
      setConversionError("");
      setShowMissingTotalsForm(false);
      if (pendingTargetUnit) {
        const target = pendingTargetUnit;
        setPendingTargetUnit(null);
        requestUnitConversion(target);
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Unable to save totals.",
      );
    } finally {
      setSavingTotals(false);
    }
  };

  const saveReview = async () => {
    if (!workId) return;
    setSavingReview(true);
    setError("");
    try {
      await apiRequest<unknown>(supabase, `/api/v1/works/${workId}/review`, {
        method: "POST",
        body: {
          title: reviewTitle.trim() || null,
          body: reviewBody,
          rating: reviewRating.trim() ? Number(reviewRating) : null,
          visibility: reviewVisibility,
        },
      });
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Unable to save review.",
      );
    } finally {
      setSavingReview(false);
    }
  };

  return (
    <section
      className="rounded-xl border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-6"
      data-test="book-detail-card"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Book details
        </h1>
        <Link
          href="/library"
          className="rounded border border-[var(--p-content-border-color)] px-3 py-2 text-sm"
        >
          Back to library
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--p-text-muted-color)]">Loading...</p>
      ) : null}
      {error ? (
        <Message
          className="mt-3"
          severity="error"
          text={error}
          data-test="book-detail-error"
        />
      ) : null}

      {!loading && work ? (
        <>
          <div className="grid gap-5 md:grid-cols-[220px_1fr]">
            <div
              className="overflow-hidden rounded border border-[var(--p-content-border-color)] bg-[var(--surface-hover)]"
              data-test="book-detail-cover"
            >
              {work.cover_url ? (
                <Image
                  src={work.cover_url}
                  alt=""
                  width={220}
                  height={320}
                  unoptimized
                  className="h-auto w-full object-cover"
                  data-test="book-detail-cover-image"
                />
              ) : (
                <CoverPlaceholder data-test="book-detail-cover-placeholder" />
              )}
            </div>

            <div>
              <p className="font-heading text-xl font-semibold tracking-tight">
                {work.title}
              </p>
              <p className="mt-1 text-sm text-[var(--p-text-muted-color)]">
                {authorLabel || "Unknown author"}
              </p>
              <p className="mt-1 text-xs text-[var(--p-text-muted-color)]">
                Work ID: {workId}
              </p>
              {work.description ? (
                <div
                  className="library-description mt-4 text-sm text-[var(--p-text-color)]"
                  data-test="book-detail-description"
                  dangerouslySetInnerHTML={{
                    __html: renderDescriptionHtml(work.description),
                  }}
                />
              ) : null}

              {libraryItem ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div data-test="book-status-open">
                    <Dropdown
                      value={libraryItem.status}
                      className="min-w-[12rem]"
                      data-test="book-status-select"
                      disabled={savingStatus}
                      options={[
                        { label: "To read", value: "to_read" },
                        { label: "Reading", value: "reading" },
                        { label: "Completed", value: "completed" },
                        { label: "Abandoned", value: "abandoned" },
                      ]}
                      optionLabel="label"
                      optionValue="value"
                      onChange={(event) =>
                        void onStatusSelected(
                          event.value as
                            | "to_read"
                            | "reading"
                            | "completed"
                            | "abandoned",
                        )
                      }
                    />
                  </div>
                  <Button
                    outlined
                    severity="secondary"
                    data-test="book-remove-open"
                    loading={removing}
                    onClick={() => setRemoveDialogOpen(true)}
                  >
                    Remove from library
                  </Button>
                  <Button
                    outlined
                    severity="secondary"
                    data-test="set-cover"
                    onClick={() => void openCoverDialog()}
                  >
                    Set cover
                  </Button>
                </div>
              ) : (
                <p className="mt-4 text-sm text-[var(--p-text-muted-color)]">
                  This book is not currently in your library.
                </p>
              )}
            </div>
          </div>

          {libraryItem ? (
            <>
              <div className="mt-6 rounded border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-4">
                <p className="text-sm font-medium">Edition and totals</p>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <Dropdown
                    className="w-full"
                    value={selectedEditionId}
                    disabled={editionsLoading}
                    options={editions.map((edition) => ({
                      label:
                        (edition.title || "Untitled edition") +
                        (edition.format ? ` (${edition.format})` : ""),
                      value: edition.id,
                    }))}
                    optionLabel="label"
                    optionValue="value"
                    onChange={(event) => {
                      const editionId = event.value as string;
                      setSelectedEditionId(editionId);
                      void setPreferredEdition(editionId);
                    }}
                  />
                  <Button
                    outlined
                    severity="secondary"
                    onClick={() => void loadStatistics(libraryItem.id)}
                    loading={statisticsLoading}
                  >
                    Refresh statistics
                  </Button>
                  <Button
                    outlined
                    severity="secondary"
                    data-test="book-enrich-open"
                    onClick={() => void loadEnrichmentCandidates()}
                    loading={enrichmentLoading}
                  >
                    Load enrichment candidates
                  </Button>
                </div>
                <p
                  className="mt-2 text-sm text-[var(--p-text-color)]"
                  data-test="progress-totals"
                >
                  Pages:{" "}
                  {bookStatistics?.totals?.total_pages ?? work.total_pages ?? 0}
                  {" • "}
                  Time:{" "}
                  {bookStatistics?.totals?.total_audio_minutes ??
                    work.total_audio_minutes ??
                    0}{" "}
                  min
                </p>
                {bookStatistics?.data_quality?.has_missing_totals ? (
                  <div
                    className="mt-2 rounded border border-[var(--p-yellow-200)] bg-[var(--p-yellow-50)] px-3 py-2"
                    data-test="missing-totals-warning"
                  >
                    <p className="text-sm text-[var(--p-yellow-700)]">
                      Some conversions need totals. Add missing totals.
                    </p>
                    <Button
                      text
                      severity="warning"
                      className="mt-1 p-0"
                      data-test="missing-totals-warning"
                      onClick={() => {
                        if (conversionMissing.length === 0) {
                          promptMissingTotalsFromIneligible();
                        }
                        setShowMissingTotalsForm(true);
                      }}
                    >
                      Add missing totals
                    </Button>
                  </div>
                ) : null}
                {bookStatistics?.streak ? (
                  <p className="mt-1 text-xs text-[var(--p-text-muted-color)]">
                    Reading streak: {bookStatistics.streak.non_zero_days} day(s)
                  </p>
                ) : null}
              </div>

              <Card className="mt-8">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar
                      icon="pi pi-clock"
                      shape="circle"
                      aria-hidden="true"
                    />
                    <p className="font-heading text-lg font-semibold tracking-tight">
                      Reading sessions
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="small"
                      severity="secondary"
                      data-test="sessions-retry"
                      disabled={!libraryItem}
                      onClick={() =>
                        libraryItem
                          ? void loadSessions(libraryItem.id)
                          : undefined
                      }
                    >
                      Retry
                    </Button>
                    {showActiveLogger && !showConvertUnitSelect ? (
                      <Button
                        outlined
                        severity="secondary"
                        data-test="convert-unit-open"
                        onClick={() => setShowConvertUnitSelect(true)}
                      >
                        Convert progress unit
                      </Button>
                    ) : showActiveLogger ? (
                      <Dropdown
                        data-test="convert-unit-select"
                        value={sessionUnit}
                        options={convertUnitOptions}
                        optionLabel="label"
                        optionValue="value"
                        optionDisabled="disabled"
                        onChange={(event) => {
                          requestUnitConversion(event.value as ProgressUnit);
                          setShowConvertUnitSelect(false);
                        }}
                      />
                    ) : null}
                  </div>
                </div>

                {sessionsError ? (
                  <div className="mt-4 flex flex-col gap-2">
                    <Message severity="error" text={sessionsError} />
                    <div>
                      <Button
                        size="small"
                        severity="secondary"
                        data-test="sessions-retry"
                        onClick={() => void loadSessions(libraryItem.id)}
                      >
                        Retry
                      </Button>
                    </div>
                  </div>
                ) : sessionsLoading ? (
                  <div className="mt-4 flex flex-col gap-2">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div
                        key={`session-skeleton-${index}`}
                        className="flex items-center gap-3"
                      >
                        <Skeleton
                          shape="circle"
                          size="0.75rem"
                          className="shrink-0"
                        />
                        <div className="flex-1">
                          <Skeleton
                            width="33%"
                            height="1rem"
                            className="mb-1"
                          />
                          <Skeleton width="50%" height="0.75rem" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : showActiveLogger ? (
                  <div
                    className="mt-4 rounded-xl border border-[var(--p-content-border-color)] p-4"
                    data-test="progress-summary"
                  >
                    <div className="mx-auto flex w-[300px] max-w-full flex-col items-center gap-4">
                      <div className="relative h-[210px] w-[210px]">
                        <Knob
                          value={Math.max(
                            0,
                            Math.min(100, currentCanonicalPercent),
                          )}
                          min={0}
                          max={100}
                          readOnly
                          size={210}
                          showValue={false}
                          strokeWidth={14}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          {editingKnobValue ? (
                            <InputText
                              className="w-[84px] text-center"
                              data-test="knob-value-input"
                              value={knobEditValue}
                              onChange={(event) =>
                                setKnobEditValue(event.target.value)
                              }
                              onBlur={() => {
                                const parsed = Number(knobEditValue.trim());
                                if (Number.isFinite(parsed) && parsed >= 0) {
                                  setSessionValue(
                                    String(Math.max(0, Math.round(parsed))),
                                  );
                                }
                                setEditingKnobValue(false);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  const parsed = Number(knobEditValue.trim());
                                  if (Number.isFinite(parsed) && parsed >= 0) {
                                    setSessionValue(
                                      String(Math.max(0, Math.round(parsed))),
                                    );
                                  }
                                  setEditingKnobValue(false);
                                }
                                if (event.key === "Escape") {
                                  setEditingKnobValue(false);
                                  setKnobEditValue(
                                    String(currentSessionNumeric),
                                  );
                                }
                              }}
                            />
                          ) : (
                            <span
                              role="button"
                              tabIndex={0}
                              className="min-w-[84px] cursor-text px-2 py-1 text-center text-xl font-semibold"
                              data-test="knob-value-display"
                              onClick={() => {
                                setKnobEditValue(String(currentSessionNumeric));
                                setEditingKnobValue(true);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  setKnobEditValue(
                                    String(currentSessionNumeric),
                                  );
                                  setEditingKnobValue(true);
                                }
                              }}
                            >
                              {knobDisplayValue}
                            </span>
                          )}
                        </div>
                      </div>
                      <Slider
                        className="w-full"
                        min={0}
                        max={sessionSliderMax}
                        step={1}
                        data-test="session-progress-slider"
                        value={Math.max(0, Math.round(currentSessionNumeric))}
                        onChange={(event) =>
                          setSessionValue(String((event.value as number) ?? 0))
                        }
                      />
                      <p
                        className="text-xs text-[var(--p-text-muted-color)]"
                        data-test="progress-cross-units"
                      >
                        Pages: {displayPagesValue} • Percentage:{" "}
                        {displayPercentValue}% • Time:{" "}
                        {formatDuration(displayMinutesValue)}
                      </p>
                      <Tag value={`${streakDays}-day streak`} severity="info" />
                      <div className="flex flex-col items-center gap-1">
                        <label className="text-xs font-medium">Log date</label>
                        <Calendar
                          data-test="session-date"
                          value={
                            sessionDate
                              ? new Date(`${sessionDate}T00:00:00`)
                              : null
                          }
                          maxDate={new Date()}
                          showIcon
                          dateFormat="mm/dd/yy"
                          onChange={(event) => {
                            if (event.value instanceof Date) {
                              setSessionDate(
                                event.value.toISOString().slice(0, 10),
                              );
                            }
                          }}
                        />
                      </div>
                      <InputTextarea
                        className="w-full max-w-[500px]"
                        value={sessionNote}
                        onChange={(event) => setSessionNote(event.target.value)}
                        placeholder="Session note"
                        rows={5}
                        autoResize
                      />
                      <Button
                        data-test="log-session"
                        loading={savingSession}
                        onClick={() => void logSession()}
                      >
                        Log session
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div
                  className="mt-4 flex flex-col items-center gap-0 text-sm"
                  data-test="progress-totals"
                >
                  <p className="m-0 font-medium">Totals</p>
                  <p className="m-0 text-xs text-[var(--p-text-muted-color)]">
                    Pages: {progressTotals.total_pages ?? 0} • Time:{" "}
                    {totalsTimeDisplay}
                  </p>
                  {(conversionMissing.length > 0 ||
                    bookStatistics?.data_quality?.has_missing_totals ||
                    bookStatistics?.data_quality?.unresolved_logs_exist) && (
                    <Button
                      text
                      severity="warning"
                      size="small"
                      data-test="missing-totals-warning"
                      onClick={() => {
                        if (conversionMissing.length === 0) {
                          setConversionMissing([
                            "total_pages",
                            "total_audio_minutes",
                          ]);
                        }
                      }}
                    >
                      Some unit conversions need totals. Add missing totals.
                    </Button>
                  )}
                  {conversionError ? (
                    <p
                      className="mt-2 rounded bg-[var(--p-yellow-50)] px-3 py-2 text-xs text-[var(--p-yellow-700)]"
                      data-test="progress-cross-units"
                    >
                      {conversionError}
                    </p>
                  ) : null}
                </div>

                <Card className="mt-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Progress trend</p>
                      <div className="flex items-center gap-2">
                        <Dropdown
                          data-test="progress-chart-unit"
                          value={progressChartUnit}
                          options={[
                            { label: "Percent", value: "percent_complete" },
                            { label: "Pages", value: "pages_read" },
                            { label: "Time", value: "minutes_listened" },
                          ]}
                          optionLabel="label"
                          optionValue="value"
                          onChange={(event) =>
                            setProgressChartUnit(event.value as ProgressUnit)
                          }
                        />
                        <Dropdown
                          data-test="progress-chart-mode"
                          value={progressChartMode}
                          options={[
                            {
                              label: "Progress over time",
                              value: "cumulative",
                            },
                            { label: "Daily gain", value: "daily" },
                          ]}
                          optionLabel="label"
                          optionValue="value"
                          onChange={(event) =>
                            setProgressChartMode(
                              event.value as "daily" | "cumulative",
                            )
                          }
                        />
                      </div>
                    </div>
                    <div className="h-[220px]" data-test="progress-chart">
                      {progressChartPoints.length ? (
                        <Chart
                          type="line"
                          data={progressChartData}
                          options={progressChartOptions}
                        />
                      ) : (
                        <p className="p-3 text-sm text-[var(--p-text-muted-color)]">
                          No sessions yet.
                        </p>
                      )}
                    </div>
                  </div>
                </Card>

                {timelineSessions.length ? (
                  <Timeline
                    value={timelineSessions}
                    align="left"
                    className="mt-4"
                    marker={() => (
                      <Avatar
                        shape="circle"
                        size="normal"
                        className="h-5 w-5"
                        aria-hidden="true"
                      />
                    )}
                    content={(item) => (
                      <div>
                        <p className="text-sm font-medium">
                          {formatDateOnly(item.loggedAt)}
                        </p>
                        <p className="text-xs text-[var(--p-text-muted-color)]">
                          Start:{" "}
                          <span className="font-medium text-[var(--p-text-muted-color)]">
                            {item.startDisplay}
                          </span>{" "}
                          • End:{" "}
                          <span className="font-semibold text-sky-700">
                            {item.endDisplay}
                          </span>{" "}
                          • This session:{" "}
                          <span
                            className={
                              item.sessionDelta > 0
                                ? "font-semibold text-emerald-600"
                                : item.sessionDelta < 0
                                  ? "font-semibold text-amber-600"
                                  : "font-semibold text-[var(--p-text-muted-color)]"
                            }
                          >
                            {item.sessionDisplay}
                          </span>
                        </p>
                        {item.note ? (
                          <p className="text-xs text-[var(--p-text-muted-color)]">
                            {item.note}
                          </p>
                        ) : null}
                      </div>
                    )}
                  />
                ) : !sessionsLoading && !sessionsError ? (
                  <p className="mt-3 text-sm text-[var(--p-text-muted-color)]">
                    No sessions yet.
                  </p>
                ) : null}
              </Card>

              <Dialog
                visible={pendingDecreaseValue !== null}
                onHide={() => setPendingDecreaseValue(null)}
                header="Lower progress?"
                style={{ width: "28rem" }}
              >
                <div className="flex flex-col gap-3">
                  <p className="text-sm">
                    This value is lower than your latest logged progress (
                    {lastLoggedValueForUnit ?? 0}). Continue anyway?
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      text
                      severity="secondary"
                      data-test="decrease-cancel"
                      onClick={() => setPendingDecreaseValue(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      data-test="decrease-confirm"
                      onClick={() => void confirmDecreaseAndLog()}
                    >
                      Continue
                    </Button>
                  </div>
                </div>
              </Dialog>

              <Dialog
                visible={showMissingTotalsForm}
                onHide={() => setShowMissingTotalsForm(false)}
                header="Add missing totals"
                style={{ width: "32rem" }}
              >
                {conversionMissing.length ? (
                  <div
                    className="flex flex-col gap-3"
                    data-test="missing-totals-dialog-content"
                  >
                    <p className="text-sm text-[var(--p-text-muted-color)]">
                      Some conversions require missing totals before they can be
                      selected.
                    </p>
                    {loadingTotalsSuggestions ? (
                      <div
                        className="flex items-center gap-2 text-xs text-[var(--p-text-muted-color)]"
                        data-test="missing-totals-suggestions-loading"
                      >
                        <i
                          className="pi pi-spin pi-spinner"
                          aria-hidden="true"
                        ></i>
                        <span>Loading suggestions...</span>
                      </div>
                    ) : null}
                    <div className="grid gap-3">
                      {conversionMissing.includes("total_pages") ? (
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium">
                            Total pages
                          </label>
                          <InputText
                            value={pendingTotalPages}
                            placeholder="Enter pages"
                            data-test="pending-total-pages"
                            onChange={(event) =>
                              setPendingTotalPages(event.target.value)
                            }
                          />
                          {totalPageSuggestions.length ? (
                            <p className="text-xs text-[var(--p-text-muted-color)]">
                              Suggestion: {totalPageSuggestions[0]} pages
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {conversionMissing.includes("total_audio_minutes") ? (
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium">
                            Total time (hh:mm:ss)
                          </label>
                          <InputText
                            value={pendingTotalAudio}
                            placeholder="Enter time"
                            data-test="pending-total-audio-minutes"
                            onChange={(event) =>
                              setPendingTotalAudio(event.target.value)
                            }
                          />
                          {totalTimeSuggestions.length ? (
                            <p className="text-xs text-[var(--p-text-muted-color)]">
                              Suggestion:{" "}
                              {minutesToHms(totalTimeSuggestions[0])}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="small"
                        loading={savingTotals}
                        data-test="save-missing-totals"
                        onClick={() => void saveMissingTotals()}
                      >
                        Save totals
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Dialog>

              <div className="mt-6 rounded border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-heading text-lg font-semibold tracking-tight">
                    Notes
                  </p>
                  <Button
                    size="small"
                    outlined
                    severity="secondary"
                    data-test="notes-retry"
                    disabled={!libraryItem}
                    onClick={() =>
                      libraryItem ? void loadNotes(libraryItem.id) : undefined
                    }
                  >
                    Retry notes
                  </Button>
                </div>
                <InputText
                  className="mt-2 w-full"
                  value={newNoteTitle}
                  onChange={(event) => setNewNoteTitle(event.target.value)}
                  placeholder="Title (optional)"
                />
                <InputTextarea
                  className="mt-2 w-full"
                  value={newNoteBody}
                  onChange={(event) => setNewNoteBody(event.target.value)}
                  placeholder="Write a note"
                  autoResize
                  rows={3}
                />
                <div className="mt-2 flex gap-2">
                  <Dropdown
                    value={newNoteVisibility}
                    options={[
                      { label: "Private", value: "private" },
                      { label: "Public", value: "public" },
                    ]}
                    optionLabel="label"
                    optionValue="value"
                    onChange={(event) =>
                      setNewNoteVisibility(event.value as "private" | "public")
                    }
                  />
                  <Button
                    outlined
                    severity="secondary"
                    onClick={() => void addNote()}
                    loading={savingNote}
                  >
                    Add note
                  </Button>
                </div>
                {notesLoading ? (
                  <p className="mt-2 text-sm text-[var(--p-text-muted-color)]">
                    Loading notes...
                  </p>
                ) : (
                  <ul className="mt-3 grid gap-2">
                    {notes.map((note) => (
                      <li
                        key={note.id}
                        className="rounded border border-[var(--p-content-border-color)] p-2"
                      >
                        <p className="text-sm font-medium">
                          {note.title || "Untitled note"}
                        </p>
                        <p className="mt-1 text-sm text-[var(--p-text-color)]">
                          {note.body}
                        </p>
                        <Button
                          size="small"
                          outlined
                          severity="secondary"
                          className="mt-2"
                          onClick={() => startEditNote(note)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="small"
                          outlined
                          severity="danger"
                          className="ml-2 mt-2"
                          onClick={() => void deleteNote(note.id)}
                        >
                          Delete
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-6 rounded border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-heading text-lg font-semibold tracking-tight">
                    Highlights
                  </p>
                  <Button
                    size="small"
                    outlined
                    severity="secondary"
                    data-test="highlights-retry"
                    disabled={!libraryItem}
                    onClick={() =>
                      libraryItem
                        ? void loadHighlights(libraryItem.id)
                        : undefined
                    }
                  >
                    Retry highlights
                  </Button>
                </div>
                <InputTextarea
                  className="mt-2 w-full"
                  value={newHighlightQuote}
                  onChange={(event) => setNewHighlightQuote(event.target.value)}
                  placeholder="Highlight quote"
                  autoResize
                  rows={3}
                />
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <Dropdown
                    value={newHighlightVisibility}
                    options={[
                      { label: "Private", value: "private" },
                      { label: "Public", value: "public" },
                    ]}
                    optionLabel="label"
                    optionValue="value"
                    onChange={(event) =>
                      setNewHighlightVisibility(
                        event.value as "private" | "public",
                      )
                    }
                  />
                  <InputText
                    value={newHighlightSort}
                    onChange={(event) =>
                      setNewHighlightSort(event.target.value)
                    }
                    placeholder="Location sort (optional)"
                  />
                  <Button
                    outlined
                    severity="secondary"
                    onClick={() => void addHighlight()}
                    loading={savingHighlight}
                  >
                    Add highlight
                  </Button>
                </div>
                {highlightsLoading ? (
                  <p className="mt-2 text-sm text-[var(--p-text-muted-color)]">
                    Loading highlights...
                  </p>
                ) : (
                  <ul className="mt-3 grid gap-2">
                    {highlights.map((highlight) => (
                      <li
                        key={highlight.id}
                        className="rounded border border-[var(--p-content-border-color)] p-2"
                      >
                        <p className="text-sm text-[var(--p-text-color)]">
                          {highlight.quote}
                        </p>
                        <Button
                          size="small"
                          outlined
                          severity="secondary"
                          className="mt-2"
                          onClick={() => startEditHighlight(highlight)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="small"
                          outlined
                          severity="danger"
                          className="ml-2 mt-2"
                          onClick={() => void deleteHighlight(highlight.id)}
                        >
                          Delete
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-6 rounded border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-4">
                <p className="text-sm font-medium">Metadata enrichment</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    outlined
                    severity="secondary"
                    data-test="book-enrich-reset"
                    loading={enrichmentLoading}
                    onClick={() => void loadEnrichmentCandidates()}
                  >
                    Refresh candidates
                  </Button>
                  <Button
                    outlined
                    severity="secondary"
                    data-test="book-enrich-pick-openlibrary"
                    disabled={enrichmentFields.length === 0}
                    onClick={() =>
                      setEnrichmentSelection(
                        Object.fromEntries(
                          enrichmentFields.map((field) => [
                            field.field_key,
                            "openlibrary",
                          ]),
                        ) as Record<
                          string,
                          "keep" | "openlibrary" | "googlebooks"
                        >,
                      )
                    }
                  >
                    Prefer Open Library
                  </Button>
                  <Button
                    outlined
                    severity="secondary"
                    data-test="book-enrich-pick-googlebooks"
                    disabled={enrichmentFields.length === 0}
                    onClick={() =>
                      setEnrichmentSelection(
                        Object.fromEntries(
                          enrichmentFields.map((field) => [
                            field.field_key,
                            "googlebooks",
                          ]),
                        ) as Record<
                          string,
                          "keep" | "openlibrary" | "googlebooks"
                        >,
                      )
                    }
                  >
                    Prefer Google Books
                  </Button>
                  <Button
                    data-test="book-enrich-apply"
                    disabled={
                      enrichmentApplying || enrichmentFields.length === 0
                    }
                    loading={enrichmentApplying}
                    onClick={() => void applyEnrichmentSelections()}
                  >
                    Apply selected
                  </Button>
                </div>
                {enrichmentFields.length ? (
                  <ul className="mt-3 grid gap-2">
                    {enrichmentFields.map((field) => (
                      <li
                        key={field.field_key}
                        className="rounded border border-[var(--p-content-border-color)] p-2"
                      >
                        {field.candidates.length > 1 ? (
                          <p
                            className="mb-1 rounded bg-[var(--p-yellow-50)] px-2 py-1 text-xs text-[var(--p-yellow-700)]"
                            data-test="book-enrich-conflict"
                          >
                            Multiple candidate sources available.
                          </p>
                        ) : null}
                        <p className="text-xs font-semibold text-[var(--p-text-muted-color)]">
                          {field.field_key}
                        </p>
                        <p
                          className="text-sm text-[var(--p-text-color)]"
                          data-test={`book-enrich-cell-${field.field_key}-current`}
                        >
                          Current: {field.current_value || "(empty)"}
                        </p>
                        <p
                          className="text-xs text-[var(--p-text-muted-color)]"
                          data-test={`book-enrich-cell-${field.field_key}-openlibrary`}
                        >
                          Open Library:{" "}
                          {field.candidates.find(
                            (candidate) => candidate.provider === "openlibrary",
                          )?.display_value || "(none)"}
                        </p>
                        <p
                          className="text-xs text-[var(--p-text-muted-color)]"
                          data-test={`book-enrich-cell-${field.field_key}-googlebooks`}
                        >
                          Google Books:{" "}
                          {field.candidates.find(
                            (candidate) => candidate.provider === "googlebooks",
                          )?.display_value || "(none)"}
                        </p>
                        <Dropdown
                          className="mt-2"
                          data-test={`book-enrich-field-${field.field_key}`}
                          value={enrichmentSelection[field.field_key] ?? "keep"}
                          options={[
                            { label: "Keep current", value: "keep" },
                            { label: "Open Library", value: "openlibrary" },
                            { label: "Google Books", value: "googlebooks" },
                          ]}
                          optionLabel="label"
                          optionValue="value"
                          onChange={(event) =>
                            setEnrichmentSelection((current) => ({
                              ...current,
                              [field.field_key]: event.value as
                                | "keep"
                                | "openlibrary"
                                | "googlebooks",
                            }))
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-[var(--p-text-muted-color)]">
                    No enrichment candidates loaded.
                  </p>
                )}
              </div>

              <div className="mt-6 rounded border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-heading text-lg font-semibold tracking-tight">
                    Your review
                  </p>
                  <Button
                    size="small"
                    outlined
                    severity="secondary"
                    data-test="review-retry"
                    onClick={() => void loadReview(workId)}
                  >
                    Retry review
                  </Button>
                </div>
                <InputText
                  className="mt-2 w-full"
                  value={reviewTitle}
                  onChange={(event) => setReviewTitle(event.target.value)}
                  placeholder="Review title"
                />
                <InputTextarea
                  className="mt-2 w-full"
                  value={reviewBody}
                  onChange={(event) => setReviewBody(event.target.value)}
                  placeholder="Write your review"
                  autoResize
                  rows={5}
                />
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <Rating
                    value={Number.parseFloat(reviewRating || "0") || 0}
                    stars={5}
                    cancel
                    onChange={(event) =>
                      setReviewRating(String((event.value as number) ?? 0))
                    }
                  />
                  <Dropdown
                    value={reviewVisibility}
                    options={[
                      { label: "Private", value: "private" },
                      { label: "Public", value: "public" },
                    ]}
                    optionLabel="label"
                    optionValue="value"
                    onChange={(event) =>
                      setReviewVisibility(
                        event.value === "public" ? "public" : "private",
                      )
                    }
                  />
                  <Button
                    outlined
                    severity="secondary"
                    disabled={savingReview || reviewLoading}
                    loading={savingReview}
                    onClick={() => void saveReview()}
                  >
                    Save review
                  </Button>
                </div>
              </div>

              {editNoteId ? (
                <div className="mt-6 rounded border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-4">
                  <p className="text-sm font-medium">Edit note</p>
                  <InputText
                    className="mt-2 w-full"
                    value={editNoteTitle}
                    onChange={(event) => setEditNoteTitle(event.target.value)}
                    placeholder="Title (optional)"
                  />
                  <InputTextarea
                    className="mt-2 w-full"
                    value={editNoteBody}
                    onChange={(event) => setEditNoteBody(event.target.value)}
                    placeholder="Note"
                    autoResize
                    rows={5}
                  />
                  <div className="mt-2 flex gap-2">
                    <Dropdown
                      value={editNoteVisibility}
                      options={[
                        { label: "Private", value: "private" },
                        { label: "Public", value: "public" },
                      ]}
                      optionLabel="label"
                      optionValue="value"
                      onChange={(event) =>
                        setEditNoteVisibility(
                          event.value === "public" ? "public" : "private",
                        )
                      }
                    />
                    <Button
                      outlined
                      severity="secondary"
                      disabled={editingNote}
                      loading={editingNote}
                      onClick={() => void saveEditedNote()}
                    >
                      Save note
                    </Button>
                    <Button
                      text
                      severity="secondary"
                      onClick={() => setEditNoteId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}

              {editHighlightId ? (
                <div className="mt-6 rounded border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-4">
                  <p className="text-sm font-medium">Edit highlight</p>
                  <InputTextarea
                    className="mt-2 w-full"
                    value={editHighlightQuote}
                    onChange={(event) =>
                      setEditHighlightQuote(event.target.value)
                    }
                    placeholder="Quote"
                    autoResize
                    rows={4}
                  />
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    <Dropdown
                      value={editHighlightVisibility}
                      options={[
                        { label: "Private", value: "private" },
                        { label: "Public", value: "public" },
                      ]}
                      optionLabel="label"
                      optionValue="value"
                      onChange={(event) =>
                        setEditHighlightVisibility(
                          event.value === "public" ? "public" : "private",
                        )
                      }
                    />
                    <InputText
                      value={editHighlightSort}
                      onChange={(event) =>
                        setEditHighlightSort(event.target.value)
                      }
                      placeholder="Location sort (optional)"
                    />
                    <Button
                      outlined
                      severity="secondary"
                      disabled={editingHighlight}
                      loading={editingHighlight}
                      onClick={() => void saveEditedHighlight()}
                    >
                      Save highlight
                    </Button>
                  </div>
                  <Button
                    text
                    severity="secondary"
                    className="mt-2"
                    onClick={() => setEditHighlightId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : null}

              {coverDialogOpen ? (
                <div className="mt-6 rounded border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Set cover</p>
                    <Button
                      outlined
                      severity="secondary"
                      size="small"
                      onClick={() => setCoverDialogOpen(false)}
                    >
                      Close
                    </Button>
                  </div>
                  <div className="mt-2">
                    <SelectButton
                      value={coverMode}
                      options={[
                        { label: "Choose", value: "choose" },
                        { label: "Upload", value: "upload" },
                        { label: "URL", value: "url" },
                      ]}
                      optionLabel="label"
                      optionValue="value"
                      onChange={(event) =>
                        setCoverMode(event.value as "choose" | "upload" | "url")
                      }
                    />
                  </div>
                  {coverError ? (
                    <Message
                      className="mt-2"
                      severity="error"
                      text={coverError}
                    />
                  ) : null}
                  <div className="mt-3">
                    <label className="text-xs text-[var(--p-text-muted-color)]">
                      Edition target
                    </label>
                    <Dropdown
                      className="mt-1 w-full"
                      value={selectedEditionId}
                      options={editions.map((edition) => ({
                        label:
                          (edition.title || "Untitled edition") +
                          (edition.format ? ` (${edition.format})` : ""),
                        value: edition.id,
                      }))}
                      optionLabel="label"
                      optionValue="value"
                      onChange={(event) =>
                        setSelectedEditionId(event.value as string)
                      }
                    />
                  </div>
                  {coverMode === "choose" ? (
                    <div className="mt-3" data-test="cover-candidates">
                      {coverCandidatesLoading ? (
                        <p className="text-sm text-[var(--p-text-muted-color)]">
                          Loading cover candidates...
                        </p>
                      ) : (
                        <ul className="grid gap-2">
                          {coverCandidates.map((candidate, index) => (
                            <li
                              key={`${candidate.source}-${candidate.cover_id ?? index}`}
                              className="flex items-center justify-between rounded border border-[var(--p-content-border-color)] p-2"
                            >
                              <span className="text-sm">
                                {candidate.source}:{" "}
                                {candidate.image_url ||
                                  candidate.source_url ||
                                  "(no preview url)"}
                              </span>
                              <Button
                                size="small"
                                outlined
                                severity="secondary"
                                data-test={`cover-candidate-${candidate.cover_id ?? index}`}
                                disabled={coverBusy}
                                onClick={() =>
                                  void selectCoverCandidate(candidate)
                                }
                              >
                                Use
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                  {coverMode === "upload" ? (
                    <div className="mt-3">
                      <FileUpload
                        mode="basic"
                        chooseLabel="Choose image"
                        accept="image/*"
                        auto={false}
                        customUpload
                        onSelect={(event: FileUploadSelectEvent) =>
                          setCoverFile(
                            (event.files as File[] | undefined)?.[0] ?? null,
                          )
                        }
                      />
                      <Button
                        className="ml-2"
                        outlined
                        severity="secondary"
                        disabled={coverBusy || !coverFile || !selectedEditionId}
                        loading={coverBusy}
                        onClick={() => void uploadCover()}
                      >
                        Upload
                      </Button>
                    </div>
                  ) : null}
                  {coverMode === "url" ? (
                    <div className="mt-3">
                      <InputText
                        className="w-full"
                        value={coverSourceUrl}
                        onChange={(event) =>
                          setCoverSourceUrl(event.target.value)
                        }
                        placeholder="https://..."
                      />
                      <Button
                        className="mt-2"
                        outlined
                        severity="secondary"
                        disabled={
                          coverBusy ||
                          !coverSourceUrl.trim() ||
                          !selectedEditionId
                        }
                        loading={coverBusy}
                        onClick={() => void cacheCover()}
                      >
                        Cache from URL
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <BookDiscoverySection
                supabase={supabase}
                workId={workId}
                authors={work.authors ?? []}
              />

              <Dialog
                visible={removeDialogOpen}
                onHide={() => setRemoveDialogOpen(false)}
                className="w-full max-w-md"
                header="Remove from library"
                data-test="book-remove-dialog"
              >
                <p className="text-sm text-[var(--p-text-color)]">
                  Remove this book from your library?
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    text
                    severity="secondary"
                    data-test="book-remove-cancel"
                    onClick={() => setRemoveDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    data-test="book-remove-confirm"
                    loading={removing}
                    disabled={removing}
                    onClick={() => {
                      setRemoveDialogOpen(false);
                      void removeFromLibrary();
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </Dialog>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
