"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "primereact/badge";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Checkbox } from "primereact/checkbox";
import { ColorPicker, type ColorPickerChangeEvent } from "primereact/colorpicker";
import { Dropdown } from "primereact/dropdown";
import { FileUpload, type FileUploadSelectEvent } from "primereact/fileupload";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Panel } from "primereact/panel";
import { Tag } from "primereact/tag";
import { ApiClientError, apiRequest } from "@/lib/api";
import { createBrowserClient } from "@/lib/supabase/browser";
import {
  applyUserTheme,
  FONT_LABELS,
  FONT_FAMILY_STACKS,
  getThemeWarnings,
  isThemeFontFamily,
  normalizeHexColor,
  type ThemeFontFamily,
} from "@/lib/user-theme";

type MeProfile = {
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  enable_google_books: boolean;
  theme_primary_color: string | null;
  theme_accent_color: string | null;
  theme_font_family: ThemeFontFamily | null;
  theme_heading_font_family: ThemeFontFamily | null;
  default_progress_unit: "pages_read" | "percent_complete" | "minutes_listened";
};

type ImportPreviewRow = {
  row_number: number;
  title: string | null;
  uid: string | null;
  result: "imported" | "failed" | "skipped";
  message: string;
};

type ImportJob = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  total_rows: number;
  processed_rows: number;
  imported_rows: number;
  failed_rows: number;
  skipped_rows: number;
  error_summary: string | null;
  rows_preview: ImportPreviewRow[];
};

type ImportIssueCode =
  | "missing_authors"
  | "missing_title"
  | "missing_read_status";

type MissingRequiredRow = {
  row_number: number;
  field: "title" | "authors" | "read_status";
  issue_code: ImportIssueCode;
  required: boolean;
  title: string | null;
  uid: string | null;
  suggested_value: string | null;
  suggestion_source: string | null;
  suggestion_confidence: "high" | "medium" | null;
};

type ImportIssue = MissingRequiredRow & {
  issueKey: string;
  value: string;
  fieldLabel: string;
  placeholder: string;
  resolution: "pending" | "resolved" | "skipped";
  skipReasonCode: ImportIssueCode;
  isEditing: boolean;
};

const primarySwatches = [
  "#6366F1",
  "#2563EB",
  "#0F766E",
  "#D946EF",
  "#F97316",
  "#BE123C",
];
const accentSwatches = [
  "#14B8A6",
  "#22C55E",
  "#F59E0B",
  "#EC4899",
  "#8B5CF6",
  "#0EA5E9",
];

const sourceMap: Record<string, string> = {
  "openlibrary:isbn": "matched by ISBN on Open Library",
  "googlebooks:isbn": "matched by ISBN on Google Books",
  "openlibrary:search": "matched by title on Open Library",
  "googlebooks:search": "matched by title on Google Books",
};
const confidenceMap: Record<string, string> = {
  high: "High confidence",
  medium: "Moderate confidence",
};

function fieldLabel(field: MissingRequiredRow["field"]) {
  if (field === "authors") return "Authors";
  if (field === "title") return "Title";
  return "Read status";
}

function fieldPlaceholder(field: MissingRequiredRow["field"]) {
  if (field === "authors") return "Author name(s), comma-separated";
  if (field === "title") return "Book title";
  return "read | to-read | currently-reading | paused | did-not-finish";
}

function issueDescription(issue: ImportIssue) {
  const name = issue.fieldLabel.toLowerCase();
  const book = issue.title
    ? `“${issue.title}”`
    : issue.uid
      ? `ISBN ${issue.uid}`
      : "an unknown book";
  return `Missing ${name} for ${book}`;
}

function suggestionConfidenceText(issue: ImportIssue) {
  const confidence = issue.suggestion_confidence
    ? (confidenceMap[issue.suggestion_confidence] ??
      issue.suggestion_confidence)
    : "";
  const source = issue.suggestion_source
    ? (sourceMap[issue.suggestion_source] ?? issue.suggestion_source)
    : "";
  if (confidence && source) return `${confidence} - ${source}`;
  return confidence || source || "";
}

const fontOptions = (Object.keys(FONT_LABELS) as ThemeFontFamily[]).map(
  (key) => ({ label: FONT_LABELS[key], value: key }),
);

export default function SettingsPage() {
  const supabase = useMemo(() => createBrowserClient(), []);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [enableGoogleBooks, setEnableGoogleBooks] = useState(false);
  const [themePrimaryColor, setThemePrimaryColor] = useState("#6366F1");
  const [themeAccentColor, setThemeAccentColor] = useState("#14B8A6");
  const [themePrimaryColorText, setThemePrimaryColorText] = useState("#6366F1");
  const [themeAccentColorText, setThemeAccentColorText] = useState("#14B8A6");
  const [themeFontFamily, setThemeFontFamily] =
    useState<ThemeFontFamily>("ibm_plex_sans");
  const [themeHeadingFontFamily, setThemeHeadingFontFamily] =
    useState<ThemeFontFamily>("ibm_plex_sans");
  const [themeFormatError, setThemeFormatError] = useState("");
  const [defaultProgressUnit, setDefaultProgressUnit] = useState<
    "pages_read" | "percent_complete" | "minutes_listened"
  >("pages_read");

  const [storygraphFile, setStorygraphFile] = useState<File | null>(null);
  const [storygraphImporting, setStorygraphImporting] = useState(false);
  const [storygraphImportError, setStorygraphImportError] = useState("");
  const [storygraphImportJob, setStorygraphImportJob] =
    useState<ImportJob | null>(null);
  const [storygraphIssues, setStorygraphIssues] = useState<ImportIssue[]>([]);
  const [storygraphIssuesLoading, setStorygraphIssuesLoading] = useState(false);
  const [storygraphIssuesLoaded, setStorygraphIssuesLoaded] = useState(false);
  const [storygraphIssuesError, setStorygraphIssuesError] = useState("");
  const storygraphPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const storygraphUploaderRootRef = useRef<HTMLDivElement | null>(null);

  const [goodreadsFile, setGoodreadsFile] = useState<File | null>(null);
  const [goodreadsImporting, setGoodreadsImporting] = useState(false);
  const [goodreadsImportError, setGoodreadsImportError] = useState("");
  const [goodreadsImportJob, setGoodreadsImportJob] =
    useState<ImportJob | null>(null);
  const [goodreadsIssues, setGoodreadsIssues] = useState<ImportIssue[]>([]);
  const [goodreadsIssuesLoading, setGoodreadsIssuesLoading] = useState(false);
  const [goodreadsIssuesLoaded, setGoodreadsIssuesLoaded] = useState(false);
  const [goodreadsIssuesError, setGoodreadsIssuesError] = useState("");
  const goodreadsPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const goodreadsUploaderRootRef = useRef<HTMLDivElement | null>(null);

  const themeWarnings = useMemo(
    () =>
      getThemeWarnings({
        theme_primary_color: themePrimaryColorText,
        theme_accent_color: themeAccentColorText,
      }),
    [themePrimaryColorText, themeAccentColorText],
  );

  const storygraphPending = storygraphIssues.filter(
    (issue) => issue.resolution === "pending",
  ).length;
  const goodreadsPending = goodreadsIssues.filter(
    (issue) => issue.resolution === "pending",
  ).length;

  const canStartStorygraphImport =
    Boolean(storygraphFile) &&
    !storygraphIssuesLoading &&
    storygraphIssuesLoaded &&
    !storygraphIssuesError &&
    storygraphPending === 0 &&
    !storygraphImporting;
  const canStartGoodreadsImport =
    Boolean(goodreadsFile) &&
    !goodreadsIssuesLoading &&
    goodreadsIssuesLoaded &&
    !goodreadsIssuesError &&
    goodreadsPending === 0 &&
    !goodreadsImporting;

  const toHexFromPicker = (event: ColorPickerChangeEvent): string | null => {
    const raw = String(event.value ?? "").replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
    return `#${raw.toUpperCase()}`;
  };

  useEffect(() => {
    let active = true;

    const loadProfile = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await apiRequest<MeProfile>(supabase, "/api/v1/me");
        if (!active) return;
        setHandle(data.handle);
        setDisplayName(data.display_name ?? "");
        setAvatarUrl(data.avatar_url ?? "");
        setEnableGoogleBooks(Boolean(data.enable_google_books));
        const normalizedPrimary =
          normalizeHexColor(data.theme_primary_color) ?? "#6366F1";
        const normalizedAccent =
          normalizeHexColor(data.theme_accent_color) ?? "#14B8A6";
        setThemePrimaryColor(normalizedPrimary);
        setThemePrimaryColorText(normalizedPrimary);
        setThemeAccentColor(normalizedAccent);
        setThemeAccentColorText(normalizedAccent);
        const bodyFont = isThemeFontFamily(data.theme_font_family)
          ? data.theme_font_family
          : "ibm_plex_sans";
        const headingFont = isThemeFontFamily(data.theme_heading_font_family)
          ? data.theme_heading_font_family
          : bodyFont;
        setThemeFontFamily(bodyFont);
        setThemeHeadingFontFamily(headingFont);
        setDefaultProgressUnit(data.default_progress_unit ?? "pages_read");
        applyUserTheme({
          theme_primary_color: normalizedPrimary,
          theme_accent_color: normalizedAccent,
          theme_font_family: bodyFont,
          theme_heading_font_family: headingFont,
        });
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Unable to load settings.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadProfile();
    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(
    () => () => {
      if (storygraphPollTimerRef.current) {
        clearTimeout(storygraphPollTimerRef.current);
      }
      if (goodreadsPollTimerRef.current) {
        clearTimeout(goodreadsPollTimerRef.current);
      }
    },
    [],
  );

  const save = async () => {
    const normalizedPrimary = normalizeHexColor(themePrimaryColorText);
    const normalizedAccent = normalizeHexColor(themeAccentColorText);
    if (themePrimaryColorText.trim() && !normalizedPrimary) {
      setThemeFormatError("Primary color must be a valid #RRGGBB value.");
      return;
    }
    if (themeAccentColorText.trim() && !normalizedAccent) {
      setThemeFormatError("Accent color must be a valid #RRGGBB value.");
      return;
    }

    setSaving(true);
    setSaved(false);
    setError("");
    setThemeFormatError("");
    try {
      await apiRequest<unknown>(supabase, "/api/v1/me", {
        method: "PATCH",
        body: {
          handle,
          display_name: displayName,
          avatar_url: avatarUrl,
          enable_google_books: enableGoogleBooks,
          theme_primary_color: normalizedPrimary,
          theme_accent_color: normalizedAccent,
          theme_font_family: themeFontFamily,
          theme_heading_font_family: themeHeadingFontFamily,
          default_progress_unit: defaultProgressUnit,
        },
      });
      applyUserTheme({
        theme_primary_color: normalizedPrimary,
        theme_accent_color: normalizedAccent,
        theme_font_family: themeFontFamily,
        theme_heading_font_family: themeHeadingFontFamily,
      });
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to save settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  const resetStorygraphIssues = () => {
    setStorygraphIssues([]);
    setStorygraphIssuesLoaded(false);
    setStorygraphIssuesLoading(false);
    setStorygraphIssuesError("");
  };

  const resetGoodreadsIssues = () => {
    setGoodreadsIssues([]);
    setGoodreadsIssuesLoaded(false);
    setGoodreadsIssuesLoading(false);
    setGoodreadsIssuesError("");
  };

  const mapIssues = (rows: MissingRequiredRow[]): ImportIssue[] =>
    rows.map((row) => ({
      ...row,
      issueKey: `${row.row_number}:${row.field}`,
      value: "",
      fieldLabel: fieldLabel(row.field),
      placeholder: fieldPlaceholder(row.field),
      resolution: "pending",
      skipReasonCode: row.issue_code,
      isEditing: !row.suggested_value,
    }));

  const loadStorygraphIssues = async (file: File) => {
    setStorygraphIssuesLoading(true);
    setStorygraphIssuesError("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await apiRequest<{ items: MissingRequiredRow[] }>(
        supabase,
        "/api/v1/imports/storygraph/missing-authors",
        { method: "POST", body: formData },
      );
      setStorygraphIssues(mapIssues(response.items));
      setStorygraphIssuesLoaded(true);
    } catch (err) {
      setStorygraphIssuesLoaded(false);
      setStorygraphIssuesError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to load import issues from StoryGraph export.",
      );
    } finally {
      setStorygraphIssuesLoading(false);
    }
  };

  const loadGoodreadsIssues = async (file: File) => {
    setGoodreadsIssuesLoading(true);
    setGoodreadsIssuesError("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await apiRequest<{ items: MissingRequiredRow[] }>(
        supabase,
        "/api/v1/imports/goodreads/missing-required",
        { method: "POST", body: formData },
      );
      setGoodreadsIssues(mapIssues(response.items));
      setGoodreadsIssuesLoaded(true);
    } catch (err) {
      setGoodreadsIssuesLoaded(false);
      setGoodreadsIssuesError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to load import issues from Goodreads export.",
      );
    } finally {
      setGoodreadsIssuesLoading(false);
    }
  };

  const pollStorygraphImportStatus = async (jobId: string) => {
    try {
      const data = await apiRequest<ImportJob>(
        supabase,
        `/api/v1/imports/storygraph/${jobId}`,
      );
      setStorygraphImportJob(data);
      if (data.status === "queued" || data.status === "running") {
        storygraphPollTimerRef.current = setTimeout(() => {
          void pollStorygraphImportStatus(jobId);
        }, 1000);
        return;
      }
      setStorygraphImporting(false);
    } catch (err) {
      setStorygraphImporting(false);
      setStorygraphImportError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to fetch import status.",
      );
    }
  };

  const pollGoodreadsImportStatus = async (jobId: string) => {
    try {
      const data = await apiRequest<ImportJob>(
        supabase,
        `/api/v1/imports/goodreads/${jobId}`,
      );
      setGoodreadsImportJob(data);
      if (data.status === "queued" || data.status === "running") {
        goodreadsPollTimerRef.current = setTimeout(() => {
          void pollGoodreadsImportStatus(jobId);
        }, 1000);
        return;
      }
      setGoodreadsImporting(false);
    } catch (err) {
      setGoodreadsImporting(false);
      setGoodreadsImportError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to fetch import status.",
      );
    }
  };

  const updateIssueValue = (
    setter: React.Dispatch<React.SetStateAction<ImportIssue[]>>,
    issueKey: string,
    value: string,
  ) => {
    setter((current) =>
      current.map((issue) =>
        issue.issueKey === issueKey
          ? {
              ...issue,
              value,
              isEditing: true,
              resolution: value.trim() ? "resolved" : "pending",
            }
          : issue,
      ),
    );
  };

  const updateIssueEditing = (
    setter: React.Dispatch<React.SetStateAction<ImportIssue[]>>,
    issueKey: string,
    isEditing: boolean,
  ) => {
    setter((current) =>
      current.map((issue) =>
        issue.issueKey === issueKey
          ? {
              ...issue,
              isEditing,
              resolution: issue.value.trim() ? "resolved" : "pending",
            }
          : issue,
      ),
    );
  };

  const applySuggestionToIssue = (
    setter: React.Dispatch<React.SetStateAction<ImportIssue[]>>,
    issueKey: string,
  ) => {
    setter((current) =>
      current.map((issue) =>
        issue.issueKey === issueKey && issue.suggested_value
          ? {
              ...issue,
              value: issue.suggested_value,
              isEditing: false,
              resolution: "resolved",
            }
          : issue,
      ),
    );
  };

  const markIssueSkipped = (
    setter: React.Dispatch<React.SetStateAction<ImportIssue[]>>,
    issueKey: string,
  ) => {
    setter((current) =>
      current.map((issue) =>
        issue.issueKey === issueKey
          ? { ...issue, isEditing: false, resolution: "skipped" }
          : issue,
      ),
    );
  };

  const undoIssueSkipped = (
    setter: React.Dispatch<React.SetStateAction<ImportIssue[]>>,
    issueKey: string,
  ) => {
    setter((current) =>
      current.map((issue) => {
        if (issue.issueKey !== issueKey) return issue;
        const resolution = issue.value.trim() ? "resolved" : "pending";
        return { ...issue, resolution, isEditing: !issue.value.trim() };
      }),
    );
  };

  const startStorygraphImport = async () => {
    if (!canStartStorygraphImport || !storygraphFile) return;

    setStorygraphImporting(true);
    setStorygraphImportError("");
    setStorygraphImportJob(null);
    if (storygraphPollTimerRef.current) {
      clearTimeout(storygraphPollTimerRef.current);
      storygraphPollTimerRef.current = null;
    }

    try {
      if (!storygraphIssuesLoaded && !storygraphIssuesLoading) {
        await loadStorygraphIssues(storygraphFile);
      }
      if (
        !storygraphIssuesLoaded ||
        storygraphIssuesError ||
        storygraphPending > 0
      ) {
        throw new Error("Import prerequisites are not complete.");
      }

      const authorOverrides: Record<string, string> = {};
      const titleOverrides: Record<string, string> = {};
      const statusOverrides: Record<string, string> = {};
      const skippedRows: number[] = [];
      const skipReasons: Record<string, string> = {};

      for (const issue of storygraphIssues) {
        if (issue.resolution === "skipped") {
          skippedRows.push(issue.row_number);
          skipReasons[String(issue.row_number)] = issue.skipReasonCode;
          continue;
        }
        const value = issue.value.trim();
        if (!value) continue;
        const key = String(issue.row_number);
        if (issue.field === "authors") authorOverrides[key] = value;
        if (issue.field === "title") titleOverrides[key] = value;
        if (issue.field === "read_status") statusOverrides[key] = value;
      }

      const formData = new FormData();
      formData.append("file", storygraphFile);
      if (Object.keys(authorOverrides).length > 0) {
        formData.append("author_overrides", JSON.stringify(authorOverrides));
      }
      if (Object.keys(titleOverrides).length > 0) {
        formData.append("title_overrides", JSON.stringify(titleOverrides));
      }
      if (Object.keys(statusOverrides).length > 0) {
        formData.append("status_overrides", JSON.stringify(statusOverrides));
      }
      if (skippedRows.length > 0) {
        formData.append("skipped_rows", JSON.stringify(skippedRows));
        formData.append("skip_reasons", JSON.stringify(skipReasons));
      }

      const created = await apiRequest<{
        job_id: string;
        status: string;
        total_rows: number;
        processed_rows: number;
        imported_rows: number;
        failed_rows: number;
        skipped_rows: number;
      }>(supabase, "/api/v1/imports/storygraph", {
        method: "POST",
        body: formData,
      });

      setStorygraphImportJob({
        job_id: created.job_id,
        status: created.status as ImportJob["status"],
        total_rows: created.total_rows,
        processed_rows: created.processed_rows,
        imported_rows: created.imported_rows,
        failed_rows: created.failed_rows,
        skipped_rows: created.skipped_rows,
        error_summary: null,
        rows_preview: [],
      });
      await pollStorygraphImportStatus(created.job_id);
    } catch (err) {
      setStorygraphImporting(false);
      setStorygraphImportError(
        err instanceof ApiClientError ? err.message : "Unable to start import.",
      );
    }
  };

  const startGoodreadsImport = async () => {
    if (!canStartGoodreadsImport || !goodreadsFile) return;

    setGoodreadsImporting(true);
    setGoodreadsImportError("");
    setGoodreadsImportJob(null);
    if (goodreadsPollTimerRef.current) {
      clearTimeout(goodreadsPollTimerRef.current);
      goodreadsPollTimerRef.current = null;
    }

    try {
      if (!goodreadsIssuesLoaded && !goodreadsIssuesLoading) {
        await loadGoodreadsIssues(goodreadsFile);
      }
      if (
        !goodreadsIssuesLoaded ||
        goodreadsIssuesError ||
        goodreadsPending > 0
      ) {
        throw new Error("Import prerequisites are not complete.");
      }

      const authorOverrides: Record<string, string> = {};
      const titleOverrides: Record<string, string> = {};
      const shelfOverrides: Record<string, string> = {};
      const skippedRows: number[] = [];
      const skipReasons: Record<string, string> = {};

      for (const issue of goodreadsIssues) {
        if (issue.resolution === "skipped") {
          skippedRows.push(issue.row_number);
          skipReasons[String(issue.row_number)] = issue.skipReasonCode;
          continue;
        }
        const value = issue.value.trim();
        if (!value) continue;
        const key = String(issue.row_number);
        if (issue.field === "authors") authorOverrides[key] = value;
        if (issue.field === "title") titleOverrides[key] = value;
        if (issue.field === "read_status") shelfOverrides[key] = value;
      }

      const formData = new FormData();
      formData.append("file", goodreadsFile);
      if (Object.keys(authorOverrides).length > 0) {
        formData.append("author_overrides", JSON.stringify(authorOverrides));
      }
      if (Object.keys(titleOverrides).length > 0) {
        formData.append("title_overrides", JSON.stringify(titleOverrides));
      }
      if (Object.keys(shelfOverrides).length > 0) {
        formData.append("shelf_overrides", JSON.stringify(shelfOverrides));
      }
      if (skippedRows.length > 0) {
        formData.append("skipped_rows", JSON.stringify(skippedRows));
        formData.append("skip_reasons", JSON.stringify(skipReasons));
      }

      const created = await apiRequest<{
        job_id: string;
        status: string;
        total_rows: number;
        processed_rows: number;
        imported_rows: number;
        failed_rows: number;
        skipped_rows: number;
      }>(supabase, "/api/v1/imports/goodreads", {
        method: "POST",
        body: formData,
      });

      setGoodreadsImportJob({
        job_id: created.job_id,
        status: created.status as ImportJob["status"],
        total_rows: created.total_rows,
        processed_rows: created.processed_rows,
        imported_rows: created.imported_rows,
        failed_rows: created.failed_rows,
        skipped_rows: created.skipped_rows,
        error_summary: null,
        rows_preview: [],
      });
      await pollGoodreadsImportStatus(created.job_id);
    } catch (err) {
      setGoodreadsImporting(false);
      setGoodreadsImportError(
        err instanceof ApiClientError ? err.message : "Unable to start import.",
      );
    }
  };

  const renderIssues = (
    issues: ImportIssue[],
    prefix: "storygraph" | "goodreads",
    setIssues: React.Dispatch<React.SetStateAction<ImportIssue[]>>,
  ) => {
    const resolvedCount = issues.filter(
      (issue) => issue.resolution === "resolved",
    ).length;
    const skippedCount = issues.filter(
      (issue) => issue.resolution === "skipped",
    ).length;
    const pendingCount = issues.filter(
      (issue) => issue.resolution === "pending",
    ).length;

    return (
      <Panel className="mt-3" data-test={`${prefix}-issues-panel`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Import issues</p>
          <Badge
            value={String(issues.length)}
            data-test={`${prefix}-issue-total-badge`}
          />
          <span className="sr-only">
            {issues.length}
          </span>
        </div>
        <p
          className="mb-3 text-xs text-[var(--p-text-muted-color)]"
          data-test={`${prefix}-issue-summary`}
        >
          Resolved {resolvedCount} · Skipped {skippedCount} · Pending{" "}
          {pendingCount}
        </p>
        <div className="grid gap-3" data-test={`${prefix}-import-issues`}>
          {issues.map((issue) => (
            <Card key={issue.issueKey}>
              <p className="text-sm font-medium">{issueDescription(issue)}</p>
              {suggestionConfidenceText(issue) ? (
                <p className="text-xs text-[var(--p-text-muted-color)]">
                  {suggestionConfidenceText(issue)}
                </p>
              ) : null}

              {issue.isEditing ? (
                <InputText
                  className="mt-2 min-w-[260px] w-full"
                  data-test={`${prefix}-import-issue-input`}
                  placeholder={issue.placeholder}
                  value={issue.value}
                  onChange={(event) =>
                    updateIssueValue(
                      setIssues,
                      issue.issueKey,
                      event.target.value,
                    )
                  }
                />
              ) : (
                <p className="mt-2 text-sm text-[var(--p-text-color)]">
                  {issue.value.trim() ||
                    issue.suggested_value ||
                    "No value set"}
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                {issue.suggested_value ? (
                  <Button
                    size="small"
                    outlined
                    severity="secondary"
                    data-test={`${prefix}-import-issue-use-suggestion`}
                    onClick={() =>
                      applySuggestionToIssue(setIssues, issue.issueKey)
                    }
                  >
                    Use suggestion
                  </Button>
                ) : null}
                {!issue.isEditing && issue.resolution !== "resolved" ? (
                  <Button
                    size="small"
                    outlined
                    severity="secondary"
                    data-test={`${prefix}-import-issue-modify`}
                    onClick={() => {
                      updateIssueEditing(setIssues, issue.issueKey, true);
                    }}
                  >
                    Modify
                  </Button>
                ) : null}
                {issue.isEditing ? (
                  <Button
                    size="small"
                    outlined
                    severity="secondary"
                    data-test={`${prefix}-import-issue-done`}
                    onClick={() => {
                      updateIssueEditing(setIssues, issue.issueKey, false);
                    }}
                  >
                    Done
                  </Button>
                ) : null}
                {issue.resolution !== "skipped" ? (
                  <Button
                    size="small"
                    outlined
                    severity="secondary"
                    data-test={`${prefix}-import-issue-mark-skip`}
                    onClick={() => markIssueSkipped(setIssues, issue.issueKey)}
                  >
                    Mark skip
                  </Button>
                ) : (
                  <Button
                    size="small"
                    outlined
                    severity="secondary"
                    data-test={`${prefix}-import-issue-undo-skip`}
                    onClick={() => undoIssueSkipped(setIssues, issue.issueKey)}
                  >
                    Undo skip
                  </Button>
                )}
              </div>
              <div className="mt-2">
                <Tag
                  value={
                    issue.resolution === "resolved"
                        ? "Resolved"
                        : issue.resolution === "skipped"
                          ? "Skipped"
                          : "Pending"
                  }
                  severity={
                    issue.resolution === "resolved"
                      ? "success"
                      : issue.resolution === "skipped"
                        ? "warning"
                        : "secondary"
                  }
                />
              </div>
            </Card>
          ))}
        </div>
      </Panel>
    );
  };

  return (
    <Card className="rounded-xl" data-test="settings-card">
      <h1 className="font-heading text-xl font-semibold tracking-tight">Profile and settings</h1>

      {loading ? (
        <p className="mt-3 text-sm text-[var(--p-text-muted-color)]">Loading settings...</p>
      ) : null}
      {error ? (
        <Message className="mt-3" severity="error" text={error} data-test="settings-error" />
      ) : null}
      {saved ? (
        <Message className="mt-3" severity="success" text="Settings saved." data-test="settings-saved" />
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Handle
          <InputText
            data-test="settings-handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Display name
          <InputText
            data-test="settings-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          Avatar URL
          <InputText
            data-test="settings-avatar-url"
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            inputId="enable-google-books"
            checked={enableGoogleBooks}
            onChange={(event) => setEnableGoogleBooks(Boolean(event.checked))}
            data-test="settings-enable-google-books"
          />
          <span>Enable Google Books</span>
        </label>
        <label className="grid gap-1 text-sm">
          Default progress unit
          <Dropdown
            value={defaultProgressUnit}
            options={[
              { label: "Pages read", value: "pages_read" },
              { label: "Percent complete", value: "percent_complete" },
              { label: "Minutes listened", value: "minutes_listened" },
            ]}
            optionLabel="label"
            optionValue="value"
            onChange={(event) =>
              setDefaultProgressUnit(
                event.value as
                  | "pages_read"
                  | "percent_complete"
                  | "minutes_listened",
              )
            }
            data-test="settings-default-progress-unit"
          />
        </label>
      </div>

      <Card className="mt-6" data-test="settings-theme-card">
        <p className="text-sm font-medium">Theme</p>
        <p className="mt-1 text-xs text-[var(--p-text-muted-color)]">
          Pick primary and accent colors plus your preferred reading font.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <label
              className="text-sm font-medium"
              htmlFor="settings-theme-primary"
            >
              Primary color
            </label>
            <div className="flex items-center gap-2">
              <ColorPicker
                id="settings-theme-primary"
                value={themePrimaryColor.replace(/^#/, "")}
                format="hex"
                data-test="settings-theme-primary-color"
                onChange={(event) => {
                  const value = toHexFromPicker(event);
                  if (!value) return;
                  setThemePrimaryColor(value);
                  setThemePrimaryColorText(value);
                }}
              />
              <InputText
                value={themePrimaryColorText}
                data-test="settings-theme-primary-hex"
                onChange={(event) => {
                  const next = event.target.value;
                  setThemePrimaryColorText(next);
                  const normalized = normalizeHexColor(next);
                  if (normalized) setThemePrimaryColor(normalized);
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {primarySwatches.map((swatch) => (
                <Button
                  key={swatch}
                  text
                  className="h-6 w-6 rounded-full border p-0"
                  style={{ backgroundColor: swatch }}
                  data-test={`settings-theme-primary-swatch-${swatch}`}
                  onClick={() => {
                    setThemePrimaryColor(swatch);
                    setThemePrimaryColorText(swatch);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <label
              className="text-sm font-medium"
              htmlFor="settings-theme-accent"
            >
              Accent color
            </label>
            <div className="flex items-center gap-2">
              <ColorPicker
                id="settings-theme-accent"
                value={themeAccentColor.replace(/^#/, "")}
                format="hex"
                data-test="settings-theme-accent-color"
                onChange={(event) => {
                  const value = toHexFromPicker(event);
                  if (!value) return;
                  setThemeAccentColor(value);
                  setThemeAccentColorText(value);
                }}
              />
              <InputText
                value={themeAccentColorText}
                data-test="settings-theme-accent-hex"
                onChange={(event) => {
                  const next = event.target.value;
                  setThemeAccentColorText(next);
                  const normalized = normalizeHexColor(next);
                  if (normalized) setThemeAccentColor(normalized);
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {accentSwatches.map((swatch) => (
                <Button
                  key={swatch}
                  text
                  className="h-6 w-6 rounded-full border p-0"
                  style={{ backgroundColor: swatch }}
                  data-test={`settings-theme-accent-swatch-${swatch}`}
                  onClick={() => {
                    setThemeAccentColor(swatch);
                    setThemeAccentColorText(swatch);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Heading font
            <Dropdown
              data-test="settings-theme-heading-font-family"
              value={themeHeadingFontFamily}
              options={fontOptions}
              optionLabel="label"
              optionValue="value"
              itemTemplate={(option) => (
                <span style={{ fontFamily: FONT_FAMILY_STACKS[option.value as ThemeFontFamily] }}>
                  {option.label}
                </span>
              )}
              onChange={(event) =>
                setThemeHeadingFontFamily(event.value as ThemeFontFamily)
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            Body font
            <Dropdown
              data-test="settings-theme-font-family"
              value={themeFontFamily}
              options={fontOptions}
              optionLabel="label"
              optionValue="value"
              itemTemplate={(option) => (
                <span style={{ fontFamily: FONT_FAMILY_STACKS[option.value as ThemeFontFamily] }}>
                  {option.label}
                </span>
              )}
              onChange={(event) =>
                setThemeFontFamily(event.value as ThemeFontFamily)
              }
            />
          </label>
        </div>
        {themeFormatError ? (
          <Message
            className="mt-3"
            severity="error"
            text={themeFormatError}
            data-test="settings-theme-format-error"
          />
        ) : null}
        {themeWarnings.map((warning) => (
          <Message
            key={`${warning.field}:${warning.message}`}
            className="mt-2"
            severity="warn"
            text={warning.message}
            data-test="settings-theme-contrast-warning"
          />
        ))}
      </Card>

      <Panel className="mt-6" data-test="storygraph-import-card">
        <p className="text-xl font-semibold tracking-tight">Import StoryGraph export</p>
        <p className="mt-1 text-xs text-[var(--p-text-muted-color)]">
          Upload CSV, resolve required fields, then import.
        </p>
        <div
          className="mt-2 flex flex-wrap gap-2 text-xs"
          data-test="storygraph-import-steps"
        >
          <Tag value="Step 1: Select CSV" severity="secondary" />
          <Tag
            value="Step 2: Resolve or skip issues"
            severity={storygraphPending > 0 ? "warning" : "success"}
          />
          <Tag value="Step 3: Start import" severity={canStartStorygraphImport ? "success" : "secondary"} />
        </div>
        <div ref={storygraphUploaderRootRef} className="hidden">
          <FileUpload
            mode="basic"
            customUpload
            auto={false}
            chooseLabel="Choose CSV"
            accept=".csv,text/csv"
            data-test="storygraph-file-input"
            onSelect={(event: FileUploadSelectEvent) => {
              const nextFile = (event.files as File[] | undefined)?.[0] ?? null;
              setStorygraphFile(nextFile);
              setStorygraphImportError("");
              setStorygraphImportJob(null);
              resetStorygraphIssues();
              if (nextFile) void loadStorygraphIssues(nextFile);
            }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            outlined
            severity="secondary"
            data-test="storygraph-file-choose"
            onClick={() => {
              const input = storygraphUploaderRootRef.current?.querySelector<HTMLInputElement>(
                'input[type="file"]',
              );
              input?.click();
            }}
          >
            Choose CSV
          </Button>
          <Button
            outlined
            severity="secondary"
            data-test="storygraph-file-clear"
            onClick={() => {
              setStorygraphFile(null);
              setStorygraphImportError("");
              setStorygraphImportJob(null);
              resetStorygraphIssues();
            }}
          >
            Clear
          </Button>
          <Button
            data-test="storygraph-import-start"
            disabled={!canStartStorygraphImport}
            loading={storygraphImporting}
            onClick={() => void startStorygraphImport()}
          >
            Start import
          </Button>
        </div>
        {storygraphFile ? (
          <p
            className="mt-2 text-xs text-[var(--p-text-muted-color)]"
            data-test="storygraph-selected-file"
          >
            {storygraphFile.name}
          </p>
        ) : null}
        {!canStartStorygraphImport && storygraphFile ? (
          <p
            className="mt-2 text-xs text-[var(--p-text-muted-color)]"
            data-test="storygraph-start-disabled-reason"
          >
            {storygraphIssuesLoading
              ? "Checking required fields in your CSV..."
              : storygraphIssuesError
                ? "Fix issue loading errors before import."
                : !storygraphIssuesLoaded
                  ? "Issue check has not completed yet."
                  : storygraphPending > 0
                    ? `Resolve or skip ${storygraphPending} pending issue${storygraphPending === 1 ? "" : "s"} to continue.`
                    : ""}
          </p>
        ) : null}
        {storygraphIssuesError ? (
          <Message
            className="mt-2"
            severity="error"
            data-test="storygraph-import-issues-error"
            content={
              <span>
                {storygraphIssuesError}
                <Button
                  size="small"
                  outlined
                  severity="secondary"
                  className="ml-2"
                  data-test="storygraph-import-issues-retry"
                  onClick={() =>
                    storygraphFile && void loadStorygraphIssues(storygraphFile)
                  }
                  label="Retry"
                />
              </span>
            }
          />
        ) : null}
        {storygraphIssuesLoading ? (
          <p
            className="mt-2 text-sm text-[var(--p-text-muted-color)]"
            data-test="storygraph-issues-loading"
          >
            Loading issues...
          </p>
        ) : null}
        {storygraphIssues.length
          ? renderIssues(storygraphIssues, "storygraph", setStorygraphIssues)
          : null}
        {storygraphImportError ? (
          <Message className="mt-2" severity="error" text={storygraphImportError} data-test="storygraph-import-error" />
        ) : null}
        {storygraphImportJob ? (
          <div className="mt-3 rounded border border-slate-300/60 p-3">
            <p
              className="text-sm font-medium"
              data-test="storygraph-import-status"
            >
              Status: {storygraphImportJob.status}
            </p>
            <p
              className="text-xs text-[var(--p-text-muted-color)]"
              data-test="storygraph-import-counts"
            >
              {storygraphImportJob.processed_rows}/
              {storygraphImportJob.total_rows} processed ·{" "}
              {storygraphImportJob.imported_rows} imported ·{" "}
              {storygraphImportJob.failed_rows} failed ·{" "}
              {storygraphImportJob.skipped_rows} skipped
            </p>
            {storygraphImportJob.error_summary ? (
              <p
                className="mt-1 text-xs text-[var(--p-red-700)]"
                data-test="storygraph-import-error-summary"
              >
                {storygraphImportJob.error_summary}
              </p>
            ) : null}
            {storygraphImportJob.rows_preview.length ? (
              <ul
                className="mt-2 list-disc pl-5 text-xs text-[var(--p-text-color)]"
                data-test="storygraph-import-preview"
              >
                {storygraphImportJob.rows_preview.map((row) => (
                  <li
                    key={`${row.row_number}:${row.message}`}
                    data-test="storygraph-import-preview-row"
                  >
                    Row {row.row_number}: {row.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel className="mt-6" data-test="goodreads-import-card">
        <p className="text-xl font-semibold tracking-tight">Import Goodreads export</p>
        <p className="mt-1 text-xs text-[var(--p-text-muted-color)]">
          Upload CSV, resolve required fields, then import.
        </p>
        <div
          className="mt-2 flex flex-wrap gap-2 text-xs"
          data-test="goodreads-import-steps"
        >
          <Tag value="Step 1: Select CSV" severity="secondary" />
          <Tag
            value="Step 2: Resolve or skip issues"
            severity={goodreadsPending > 0 ? "warning" : "success"}
          />
          <Tag value="Step 3: Start import" severity={canStartGoodreadsImport ? "success" : "secondary"} />
        </div>
        <div ref={goodreadsUploaderRootRef} className="hidden">
          <FileUpload
            mode="basic"
            customUpload
            auto={false}
            chooseLabel="Choose CSV"
            accept=".csv,text/csv"
            data-test="goodreads-file-input"
            onSelect={(event: FileUploadSelectEvent) => {
              const nextFile = (event.files as File[] | undefined)?.[0] ?? null;
              setGoodreadsFile(nextFile);
              setGoodreadsImportError("");
              setGoodreadsImportJob(null);
              resetGoodreadsIssues();
              if (nextFile) void loadGoodreadsIssues(nextFile);
            }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            outlined
            severity="secondary"
            data-test="goodreads-file-choose"
            onClick={() => {
              const input = goodreadsUploaderRootRef.current?.querySelector<HTMLInputElement>(
                'input[type="file"]',
              );
              input?.click();
            }}
          >
            Choose CSV
          </Button>
          <Button
            outlined
            severity="secondary"
            data-test="goodreads-file-clear"
            onClick={() => {
              setGoodreadsFile(null);
              setGoodreadsImportError("");
              setGoodreadsImportJob(null);
              resetGoodreadsIssues();
            }}
          >
            Clear
          </Button>
          <Button
            data-test="goodreads-import-start"
            disabled={!canStartGoodreadsImport}
            loading={goodreadsImporting}
            onClick={() => void startGoodreadsImport()}
          >
            Start import
          </Button>
        </div>
        {goodreadsFile ? (
          <p
            className="mt-2 text-xs text-[var(--p-text-muted-color)]"
            data-test="goodreads-selected-file"
          >
            {goodreadsFile.name}
          </p>
        ) : null}
        {!canStartGoodreadsImport && goodreadsFile ? (
          <p
            className="mt-2 text-xs text-[var(--p-text-muted-color)]"
            data-test="goodreads-start-disabled-reason"
          >
            {goodreadsIssuesLoading
              ? "Checking required fields in your CSV..."
              : goodreadsIssuesError
                ? "Fix issue loading errors before import."
                : !goodreadsIssuesLoaded
                  ? "Issue check has not completed yet."
                  : goodreadsPending > 0
                    ? `Resolve or skip ${goodreadsPending} pending issue${goodreadsPending === 1 ? "" : "s"} to continue.`
                    : ""}
          </p>
        ) : null}
        {goodreadsIssuesError ? (
          <Message
            className="mt-2"
            severity="error"
            data-test="goodreads-import-issues-error"
            content={
              <span>
                {goodreadsIssuesError}
                <Button
                  size="small"
                  outlined
                  severity="secondary"
                  className="ml-2"
                  data-test="goodreads-import-issues-retry"
                  onClick={() =>
                    goodreadsFile && void loadGoodreadsIssues(goodreadsFile)
                  }
                  label="Retry"
                />
              </span>
            }
          />
        ) : null}
        {goodreadsIssuesLoading ? (
          <p
            className="mt-2 text-sm text-[var(--p-text-muted-color)]"
            data-test="goodreads-issues-loading"
          >
            Loading issues...
          </p>
        ) : null}
        {goodreadsIssues.length
          ? renderIssues(goodreadsIssues, "goodreads", setGoodreadsIssues)
          : null}
        {goodreadsImportError ? (
          <Message className="mt-2" severity="error" text={goodreadsImportError} data-test="goodreads-import-error" />
        ) : null}
        {goodreadsImportJob ? (
          <div className="mt-3 rounded border border-slate-300/60 p-3">
            <p
              className="text-sm font-medium"
              data-test="goodreads-import-status"
            >
              Status: {goodreadsImportJob.status}
            </p>
            <p
              className="text-xs text-[var(--p-text-muted-color)]"
              data-test="goodreads-import-counts"
            >
              {goodreadsImportJob.processed_rows}/
              {goodreadsImportJob.total_rows} processed ·{" "}
              {goodreadsImportJob.imported_rows} imported ·{" "}
              {goodreadsImportJob.failed_rows} failed ·{" "}
              {goodreadsImportJob.skipped_rows} skipped
            </p>
            {goodreadsImportJob.error_summary ? (
              <p
                className="mt-1 text-xs text-[var(--p-red-700)]"
                data-test="goodreads-import-error-summary"
              >
                {goodreadsImportJob.error_summary}
              </p>
            ) : null}
            {goodreadsImportJob.rows_preview.length ? (
              <ul
                className="mt-2 list-disc pl-5 text-xs text-[var(--p-text-color)]"
                data-test="goodreads-import-preview"
              >
                {goodreadsImportJob.rows_preview.map((row) => (
                  <li
                    key={`${row.row_number}:${row.message}`}
                    data-test="goodreads-import-preview-row"
                  >
                    Row {row.row_number}: {row.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Button
        className="mt-6"
        data-test="settings-save"
        onClick={() => void save()}
        disabled={saving || loading}
        loading={saving}
      >
        Save settings
      </Button>
    </Card>
  );
}
