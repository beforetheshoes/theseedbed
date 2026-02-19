"use client";

import Image from "next/image";
import { type ReactNode } from "react";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { Message } from "primereact/message";
import { Tag } from "primereact/tag";
import type {
  Edition,
  EnrichmentCandidate,
  EnrichmentField,
} from "@/components/library/workflows/types";
import { shouldUseUnoptimizedForUrl } from "@/lib/image-optimization";

type SelectionValue = "keep" | "openlibrary" | "googlebooks";

type Props = {
  visible: boolean;
  headerTitle: string;
  workflowError: string;
  workflowEditionId: string;
  workflowEditionsLoading: boolean;
  workflowEditions: Edition[];
  showEditionPicker: boolean;
  editionResolver?: ReactNode;
  enrichmentLoading: boolean;
  enrichmentApplying: boolean;
  enrichmentFields: EnrichmentField[];
  enrichmentSelection: Record<string, SelectionValue>;
  onHide: () => void;
  onEditionChange: (editionId: string) => void;
  onRefresh: () => void;
  onApplySelected: () => void;
  onPreferOpenLibrary: () => void;
  onPreferGoogleBooks: () => void;
  onResetCurrent: () => void;
  onSelectionChange: (fieldKey: string, value: SelectionValue) => void;
};

const formatEnrichmentValue = (value: unknown) => {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string") return value.trim() || "(empty)";
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const providerValue = (
  candidates: EnrichmentCandidate[],
  provider: "openlibrary" | "googlebooks",
) => candidates.find((candidate) => candidate.provider === provider);

const toImageUrl = (value: unknown) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "";
};

export function EnrichMetadataDialog({
  visible,
  headerTitle,
  workflowError,
  workflowEditionId,
  workflowEditionsLoading,
  workflowEditions,
  showEditionPicker,
  editionResolver,
  enrichmentLoading,
  enrichmentApplying,
  enrichmentFields,
  enrichmentSelection,
  onHide,
  onEditionChange,
  onRefresh,
  onApplySelected,
  onPreferOpenLibrary,
  onPreferGoogleBooks,
  onResetCurrent,
  onSelectionChange,
}: Props) {
  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      className="w-full max-w-[80rem]"
      header={headerTitle}
      modal
      draggable={false}
      data-test="library-workflow-enrich-dialog"
    >
      <div className="flex max-h-[78vh] flex-col gap-4 overflow-hidden">
        {workflowError ? (
          <Message severity="error" text={workflowError} />
        ) : null}
        {editionResolver}

        <div className="flex flex-wrap items-center gap-2">
          {showEditionPicker ? (
            <Dropdown
              value={workflowEditionId}
              disabled={workflowEditionsLoading}
              options={workflowEditions.map((edition) => ({
                label:
                  (edition.title || "Untitled edition") +
                  (edition.format ? ` (${edition.format})` : ""),
                value: edition.id,
              }))}
              optionLabel="label"
              optionValue="value"
              placeholder="Select edition target"
              onChange={(event) => onEditionChange(event.value as string)}
            />
          ) : (
            <p className="text-sm text-[var(--p-text-muted-color)]">
              Applying to your only available edition target.
            </p>
          )}
          <Button
            label="Refresh candidates"
            severity="secondary"
            outlined
            loading={enrichmentLoading}
            onClick={onRefresh}
          />
          <Button
            label="Apply selected"
            loading={enrichmentApplying}
            disabled={enrichmentApplying || enrichmentFields.length === 0}
            onClick={onApplySelected}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            label="Prefer Open Library"
            outlined
            severity="secondary"
            disabled={enrichmentFields.length === 0}
            onClick={onPreferOpenLibrary}
          />
          <Button
            label="Prefer Google Books"
            outlined
            severity="secondary"
            disabled={enrichmentFields.length === 0}
            onClick={onPreferGoogleBooks}
          />
          <Button
            label="Reset all to current"
            text
            severity="secondary"
            disabled={enrichmentFields.length === 0}
            onClick={onResetCurrent}
          />
        </div>

        {enrichmentLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-8 rounded border border-[var(--p-content-border-color)] bg-[var(--surface-ground)]"
              />
            ))}
          </div>
        ) : enrichmentFields.length ? (
          <div className="flex max-h-[58vh] flex-col gap-3 overflow-auto pr-1">
            <div className="hidden gap-3 border-b border-[var(--p-content-border-color)] px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--p-text-muted-color)] md:grid md:grid-cols-[180px_1fr_1fr_1fr]">
              <p>Field</p>
              <p>Current</p>
              <p>Open Library</p>
              <p>Google Books</p>
            </div>

            {enrichmentFields.map((field) => {
              const openLibrary = providerValue(
                field.candidates,
                "openlibrary",
              );
              const googleBooks = providerValue(
                field.candidates,
                "googlebooks",
              );
              const fieldIsCover = field.field_key === "work.cover_url";
              return (
                <div
                  key={field.field_key}
                  className="rounded-lg border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-3"
                  data-test={`book-enrich-field-${field.field_key}`}
                >
                  <div className="grid gap-3 md:grid-cols-[180px_1fr_1fr_1fr]">
                    <div className="md:pt-2">
                      <div className="flex items-center justify-between gap-2 md:block">
                        <p className="text-sm font-medium">{field.field_key}</p>
                        {field.has_conflict ? (
                          <Tag value="Conflict" severity="warning" />
                        ) : null}
                      </div>
                    </div>

                    <label
                      className={`flex cursor-pointer flex-col gap-2 rounded border p-3 transition ${
                        enrichmentSelection[field.field_key] === "keep"
                          ? "border-[var(--p-primary-color)] bg-[color-mix(in_srgb,var(--p-primary-color)_8%,transparent)]"
                          : "border-[var(--p-content-border-color)]"
                      }`}
                    >
                      <span className="inline-flex items-center gap-2 text-sm font-medium">
                        <input
                          type="radio"
                          checked={
                            enrichmentSelection[field.field_key] === "keep"
                          }
                          onChange={() =>
                            onSelectionChange(field.field_key, "keep")
                          }
                          name={`pick-${field.field_key}`}
                          value="keep"
                          className="h-4 w-4"
                        />
                        Current
                      </span>
                      {fieldIsCover ? (
                        <div className="mt-1">
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
                              <div className="flex h-36 items-center justify-center bg-[var(--p-surface-100)] px-2 text-sm text-[var(--p-text-muted-color)] dark:bg-[var(--p-surface-800)]">
                                No current cover
                              </div>
                            )}
                          </div>
                          <details className="mt-2 text-xs text-[var(--p-text-muted-color)]">
                            <summary className="cursor-pointer select-none">
                              Show raw value
                            </summary>
                            <p className="mt-2 break-all">
                              {formatEnrichmentValue(field.current_value)}
                            </p>
                          </details>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-sm">
                          {formatEnrichmentValue(field.current_value)}
                        </p>
                      )}
                    </label>

                    {(
                      [
                        ["openlibrary", openLibrary, "Open Library"],
                        ["googlebooks", googleBooks, "Google Books"],
                      ] as const
                    ).map(([provider, candidate, label]) => (
                      <label
                        key={provider}
                        className={`flex flex-col gap-2 rounded border p-3 transition ${
                          !candidate
                            ? "cursor-not-allowed opacity-60"
                            : enrichmentSelection[field.field_key] === provider
                              ? "cursor-pointer border-[var(--p-primary-color)] bg-[color-mix(in_srgb,var(--p-primary-color)_8%,transparent)]"
                              : "cursor-pointer border-[var(--p-content-border-color)]"
                        }`}
                      >
                        <span className="inline-flex items-center gap-2 text-sm font-medium">
                          <input
                            type="radio"
                            checked={
                              enrichmentSelection[field.field_key] === provider
                            }
                            onChange={() =>
                              onSelectionChange(field.field_key, provider)
                            }
                            name={`pick-${field.field_key}`}
                            value={provider}
                            disabled={!candidate}
                            className="h-4 w-4"
                          />
                          {label}
                        </span>
                        {fieldIsCover ? (
                          <div className="mt-1">
                            <div className="overflow-hidden rounded border border-[var(--p-content-border-color)]">
                              {toImageUrl(
                                candidate?.display_value || candidate?.value,
                              ) ? (
                                <Image
                                  src={toImageUrl(
                                    candidate?.display_value ||
                                      candidate?.value,
                                  )}
                                  alt=""
                                  width={240}
                                  height={144}
                                  unoptimized={shouldUseUnoptimizedForUrl(
                                    toImageUrl(
                                      candidate?.display_value ||
                                        candidate?.value,
                                    ),
                                  )}
                                  className="h-36 w-full bg-black/5 object-contain"
                                />
                              ) : (
                                <div className="flex h-36 items-center justify-center bg-[var(--p-surface-100)] px-2 text-sm text-[var(--p-text-muted-color)] dark:bg-[var(--p-surface-800)]">
                                  No {label} result
                                </div>
                              )}
                            </div>
                            <details className="mt-2 text-xs text-[var(--p-text-muted-color)]">
                              <summary className="cursor-pointer select-none">
                                Show raw value
                              </summary>
                              <p className="mt-2 break-all">
                                {formatEnrichmentValue(
                                  candidate?.display_value,
                                )}
                              </p>
                            </details>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap break-words text-sm">
                            {formatEnrichmentValue(
                              candidate?.display_value || "No suggestion",
                            )}
                          </p>
                        )}
                        {candidate?.source_label ? (
                          <p className="text-xs text-[var(--p-text-muted-color)]">
                            {candidate.source_label}
                          </p>
                        ) : null}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-[var(--p-text-muted-color)]">
            No enrichment candidates loaded.
          </p>
        )}
      </div>
    </Dialog>
  );
}
