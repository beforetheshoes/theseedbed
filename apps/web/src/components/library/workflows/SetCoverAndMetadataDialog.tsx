"use client";

import Image from "next/image";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { SelectButton } from "primereact/selectbutton";
import type { Edition } from "@/components/library/workflows/types";
import { renderDescriptionHtml } from "@/lib/description";
import { shouldUseUnoptimizedForUrl } from "@/lib/image-optimization";

type CoverMetadataMode = "choose" | "upload" | "url";
type SelectionValue = "current" | "selected";

export type ProviderSourceTile = {
  provider: "openlibrary" | "googlebooks";
  source_id: string;
  title: string;
  authors: string[];
  publisher: string | null;
  publish_date: string | null;
  language: string | null;
  identifier: string;
  cover_url: string | null;
  source_label: string;
};

export type CoverMetadataCompareField = {
  field_key: string;
  field_label: string;
  current_value: unknown;
  selected_value: unknown;
  selected_available: boolean;
  provider: "openlibrary" | "googlebooks";
  provider_id: string;
};

type Props = {
  visible: boolean;
  headerTitle: string;
  workflowError: string;
  mode: CoverMetadataMode;
  loadingSources: boolean;
  sourceError: string;
  sourceLanguageFilter: string;
  sourceTiles: ProviderSourceTile[];
  selectedSourceKey: string;
  compareLoading: boolean;
  compareFields: CoverMetadataCompareField[];
  fieldSelection: Record<string, SelectionValue>;
  enrichmentApplying: boolean;
  coverBusy: boolean;
  workflowEditions: Edition[];
  workflowEditionId: string;
  coverSourceUrl: string;
  hasSelectedFile: boolean;
  canEditEditionTarget: boolean;
  onHide: () => void;
  onModeChange: (mode: CoverMetadataMode) => void;
  onSourceLanguageFilterChange: (value: string) => void;
  onRefreshSources: () => void;
  onSelectSource: (tile: ProviderSourceTile) => void;
  onResetAllToCurrent: () => void;
  onApplySelected: () => void;
  onFieldSelectionChange: (fieldKey: string, value: SelectionValue) => void;
  onFileChange: (file: File | null) => void;
  onUploadCover: () => void;
  onCoverSourceUrlChange: (value: string) => void;
  onCacheCover: () => void;
};

const formatValue = (value: unknown) => {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string") return value.trim() || "(empty)";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const toImageUrl = (value: unknown) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : "";
};

const renderFieldText = (fieldKey: string, value: unknown) => {
  if (
    fieldKey === "work.description" &&
    typeof value === "string" &&
    value.trim()
  ) {
    const html = renderDescriptionHtml(value);
    if (html) {
      return (
        <div
          className="prose prose-sm max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
  }
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {formatValue(value)}
    </p>
  );
};

export function SetCoverAndMetadataDialog({
  visible,
  headerTitle,
  workflowError,
  mode,
  loadingSources,
  sourceError,
  sourceLanguageFilter,
  sourceTiles,
  selectedSourceKey,
  compareLoading,
  compareFields,
  fieldSelection,
  enrichmentApplying,
  coverBusy,
  workflowEditions,
  workflowEditionId,
  coverSourceUrl,
  hasSelectedFile,
  canEditEditionTarget,
  onHide,
  onModeChange,
  onSourceLanguageFilterChange,
  onRefreshSources,
  onSelectSource,
  onResetAllToCurrent,
  onApplySelected,
  onFieldSelectionChange,
  onFileChange,
  onUploadCover,
  onCoverSourceUrlChange,
  onCacheCover,
}: Props) {
  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      className="w-full max-w-[84rem]"
      header={headerTitle}
      modal
      draggable={false}
      data-test="library-workflow-set-cover-and-metadata-dialog"
    >
      <div className="flex max-h-[82vh] flex-col gap-4 overflow-hidden">
        {workflowError ? (
          <Message severity="error" text={workflowError} />
        ) : null}
        <SelectButton
          value={mode}
          options={[
            { label: "Choose", value: "choose" },
            { label: "Upload", value: "upload" },
            { label: "URL", value: "url" },
          ]}
          optionLabel="label"
          optionValue="value"
          onChange={(event) =>
            onModeChange(event.value as "choose" | "upload" | "url")
          }
        />

        {mode === "choose" ? (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="rounded-lg border border-[var(--p-content-border-color)] bg-[var(--surface-ground)] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Find editions and volumes</p>
                <div className="flex items-center gap-2">
                  <InputText
                    value={sourceLanguageFilter}
                    onChange={(event) =>
                      onSourceLanguageFilterChange(event.target.value)
                    }
                    placeholder="Language (e.g. eng)"
                    className="w-[11rem]"
                  />
                  <Button
                    label="Refresh"
                    size="small"
                    severity="secondary"
                    outlined
                    loading={loadingSources}
                    onClick={onRefreshSources}
                  />
                </div>
              </div>
              {sourceError ? (
                <Message severity="error" text={sourceError} />
              ) : null}

              <div className="grid max-h-[34vh] gap-3 overflow-auto pr-1 md:grid-cols-2 2xl:grid-cols-3">
                {sourceTiles.map((item) => {
                  const sourceKey = `${item.provider}:${item.source_id}`;
                  const selected = sourceKey === selectedSourceKey;
                  return (
                    <button
                      key={sourceKey}
                      type="button"
                      className={`grid grid-cols-[96px_1fr] gap-3 rounded border p-3 text-left transition ${
                        selected
                          ? "border-[var(--p-primary-color)] bg-[color-mix(in_srgb,var(--p-primary-color)_8%,transparent)]"
                          : "border-[var(--p-content-border-color)] bg-[var(--surface-card)]"
                      }`}
                      onClick={() => onSelectSource(item)}
                    >
                      <div className="h-[144px] w-[96px] overflow-hidden rounded border border-[var(--p-content-border-color)] bg-black/5 dark:bg-white/5">
                        {item.cover_url ? (
                          <Image
                            src={item.cover_url}
                            alt=""
                            width={96}
                            height={144}
                            unoptimized={shouldUseUnoptimizedForUrl(
                              item.cover_url,
                            )}
                            className="mx-auto h-full w-auto max-w-full object-contain"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-semibold">
                          {item.title}
                        </p>
                        <p className="mt-1 text-xs text-[var(--p-text-muted-color)]">
                          {item.source_label}
                        </p>
                        <p className="line-clamp-1 text-xs text-[var(--p-text-muted-color)]">
                          {item.authors.join(", ") || "Unknown author"}
                        </p>
                        <p className="mt-1 text-xs text-[var(--p-text-muted-color)]">
                          <span className="font-semibold">Publisher:</span>{" "}
                          {item.publisher || "Unknown"}
                        </p>
                        <p className="text-xs text-[var(--p-text-muted-color)]">
                          <span className="font-semibold">Publish Date:</span>{" "}
                          {item.publish_date || "Unknown"}
                        </p>
                        <p className="text-xs text-[var(--p-text-muted-color)]">
                          <span className="font-semibold">Language:</span>{" "}
                          {item.language || "n/a"}
                        </p>
                        <p className="line-clamp-1 text-xs text-[var(--p-text-muted-color)]">
                          <span className="font-semibold">ID:</span>{" "}
                          <span className="font-mono">{item.identifier}</span>
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                label="Reset all to current"
                severity="secondary"
                text
                disabled={!compareFields.length || enrichmentApplying}
                onClick={onResetAllToCurrent}
              />
              <Button
                label="Apply selected"
                loading={enrichmentApplying}
                disabled={!compareFields.length || enrichmentApplying}
                onClick={onApplySelected}
              />
            </div>

            {compareLoading ? (
              <div className="text-sm text-[var(--p-text-muted-color)]">
                Loading selected metadata...
              </div>
            ) : compareFields.length ? (
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-3">
                <div className="grid gap-3 border-b border-[var(--p-content-border-color)] pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--p-text-muted-color)] md:grid-cols-[180px_1fr_1fr]">
                  <p>Field</p>
                  <p>Current</p>
                  <p>Selected</p>
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  {compareFields.map((field) => {
                    const fieldIsCover = field.field_key === "work.cover_url";
                    const selectedValue = field.selected_value;
                    return (
                      <div
                        key={field.field_key}
                        className="grid gap-3 rounded border border-[var(--p-content-border-color)] p-3 md:grid-cols-[180px_1fr_1fr]"
                      >
                        <p className="text-sm font-medium">
                          {field.field_label}
                        </p>
                        <label className="flex cursor-pointer flex-col gap-2 rounded border border-[var(--p-content-border-color)] p-3">
                          <span className="inline-flex items-center gap-2 text-sm font-medium">
                            <input
                              type="radio"
                              checked={
                                fieldSelection[field.field_key] === "current"
                              }
                              onChange={() =>
                                onFieldSelectionChange(
                                  field.field_key,
                                  "current",
                                )
                              }
                              name={`pick-${field.field_key}`}
                              value="current"
                              className="h-4 w-4"
                            />
                            Current
                          </span>
                          {fieldIsCover ? (
                            <div className="overflow-hidden rounded border border-[var(--p-content-border-color)]">
                              {toImageUrl(field.current_value) ? (
                                <Image
                                  src={toImageUrl(field.current_value)}
                                  alt=""
                                  width={240}
                                  height={144}
                                  unoptimized={shouldUseUnoptimizedForUrl(
                                    toImageUrl(field.current_value),
                                  )}
                                  className="h-36 w-full bg-black/5 object-contain"
                                />
                              ) : (
                                <div className="flex h-36 items-center justify-center bg-[var(--p-surface-100)] text-sm text-[var(--p-text-muted-color)] dark:bg-[var(--p-surface-800)]">
                                  No current cover
                                </div>
                              )}
                            </div>
                          ) : (
                            renderFieldText(
                              field.field_key,
                              field.current_value,
                            )
                          )}
                        </label>
                        <label
                          className={`flex flex-col gap-2 rounded border p-3 ${
                            field.selected_available
                              ? "cursor-pointer border-[var(--p-content-border-color)]"
                              : "cursor-not-allowed border-[var(--p-content-border-color)] opacity-60"
                          }`}
                        >
                          <span className="inline-flex items-center gap-2 text-sm font-medium">
                            <input
                              type="radio"
                              checked={
                                fieldSelection[field.field_key] === "selected"
                              }
                              onChange={() =>
                                onFieldSelectionChange(
                                  field.field_key,
                                  "selected",
                                )
                              }
                              name={`pick-${field.field_key}`}
                              value="selected"
                              disabled={!field.selected_available}
                              className="h-4 w-4"
                            />
                            Selected
                          </span>
                          {fieldIsCover ? (
                            <div className="overflow-hidden rounded border border-[var(--p-content-border-color)]">
                              {toImageUrl(selectedValue) ? (
                                <Image
                                  src={toImageUrl(selectedValue)}
                                  alt=""
                                  width={240}
                                  height={144}
                                  unoptimized={shouldUseUnoptimizedForUrl(
                                    toImageUrl(selectedValue),
                                  )}
                                  className="h-36 w-full bg-black/5 object-contain"
                                />
                              ) : (
                                <div className="flex h-36 items-center justify-center bg-[var(--p-surface-100)] text-sm text-[var(--p-text-muted-color)] dark:bg-[var(--p-surface-800)]">
                                  Not available
                                </div>
                              )}
                            </div>
                          ) : field.selected_available ? (
                            renderFieldText(field.field_key, selectedValue)
                          ) : (
                            <p className="whitespace-pre-wrap break-words text-sm">
                              Not available
                            </p>
                          )}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--p-text-muted-color)]">
                Select an edition or volume above to compare metadata.
              </p>
            )}
          </div>
        ) : null}

        {mode === "upload" ? (
          <div className="flex flex-col gap-3">
            <input
              type="file"
              accept="image/*"
              onChange={(event) =>
                onFileChange(event.target.files?.[0] ?? null)
              }
            />
            <div className="flex justify-end">
              <Button
                label="Upload"
                disabled={
                  !workflowEditionId ||
                  workflowEditions.length === 0 ||
                  !hasSelectedFile ||
                  coverBusy ||
                  !canEditEditionTarget
                }
                loading={coverBusy}
                onClick={onUploadCover}
              />
            </div>
          </div>
        ) : null}

        {mode === "url" ? (
          <div className="flex flex-col gap-3">
            <InputText
              value={coverSourceUrl}
              placeholder="https://covers.openlibrary.org/..."
              onChange={(event) => onCoverSourceUrlChange(event.target.value)}
            />
            <div className="flex justify-end">
              <Button
                label="Cache from URL"
                disabled={
                  !workflowEditionId ||
                  workflowEditions.length === 0 ||
                  !coverSourceUrl.trim() ||
                  coverBusy ||
                  !canEditEditionTarget
                }
                loading={coverBusy}
                onClick={onCacheCover}
              />
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
