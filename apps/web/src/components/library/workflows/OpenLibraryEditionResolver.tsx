"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

export type OpenLibraryEditionCandidate = {
  work_key: string;
  work_title: string | null;
  work_authors: string[];
  edition_key: string;
  title: string | null;
  publisher: string | null;
  publish_date: string | null;
  language: string | null;
  isbn10: string | null;
  isbn13: string | null;
  cover_url: string | null;
  imported_edition_id: string | null;
};

type Props = {
  loading: boolean;
  error: string;
  languageFilter: string;
  items: OpenLibraryEditionCandidate[];
  importingEditionKey: string | null;
  onLanguageFilterChange: (value: string) => void;
  onRefresh: () => void;
  onImportAndUse: (editionKey: string, workKey: string) => void;
  onUseImported: (editionId: string) => void;
};

export function OpenLibraryEditionResolver({
  loading,
  error,
  languageFilter,
  items,
  importingEditionKey,
  onLanguageFilterChange,
  onRefresh,
  onImportAndUse,
  onUseImported,
}: Props) {
  const pageSize = 10;
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage],
  );

  const workSubtitle = (item: OpenLibraryEditionCandidate) => {
    const label = item.work_title?.trim();
    if (label && label !== "Mapped Open Library work") {
      return item.work_authors.length
        ? `${label} · ${item.work_authors.join(", ")}`
        : label;
    }
    if (item.work_authors.length) {
      return item.work_authors.join(", ");
    }
    return "";
  };

  return (
    <div className="rounded-lg border border-[var(--p-content-border-color)] bg-[var(--surface-ground)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Find Open Library editions</p>
        <div className="flex items-center gap-2">
          <InputText
            value={languageFilter}
            onChange={(event) => onLanguageFilterChange(event.target.value)}
            placeholder="Language (e.g. eng)"
            className="w-[11rem]"
          />
          <Button
            label="Refresh editions"
            size="small"
            severity="secondary"
            outlined
            loading={loading}
            onClick={onRefresh}
          />
        </div>
      </div>

      {error ? <Message severity="error" text={error} /> : null}

      {items.length ? (
        <div className="space-y-2">
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {pagedItems.map((item) => (
              <div
                key={item.edition_key}
                className="grid grid-cols-[120px_1fr] gap-3 rounded border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-3"
              >
                <div className="h-[180px] w-[120px] overflow-hidden rounded border border-[var(--p-content-border-color)] bg-black/5 dark:bg-white/5">
                  {item.cover_url ? (
                    <Image
                      src={item.cover_url}
                      alt=""
                      width={120}
                      height={180}
                      unoptimized
                      className="mx-auto h-full w-auto max-w-full object-contain"
                    />
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="line-clamp-2 text-sm font-semibold">
                    {item.title || "Untitled edition"}
                  </p>
                  {workSubtitle(item) ? (
                    <p className="line-clamp-1 text-xs text-[var(--p-text-muted-color)]">
                      {workSubtitle(item)}
                    </p>
                  ) : null}
                  <div className="mt-0.5 space-y-0.5 text-xs text-[var(--p-text-muted-color)]">
                    <p>
                      <span className="font-semibold">Publisher:</span>{" "}
                      {item.publisher || "Unknown"}
                    </p>
                    <p>
                      <span className="font-semibold">Publish Date:</span>{" "}
                      {item.publish_date || "Unknown"}
                    </p>
                    <p>
                      <span className="font-semibold">Language:</span>{" "}
                      {item.language || "n/a"}
                    </p>
                    <p className="line-clamp-1">
                      <span className="font-semibold">Edition ID:</span>{" "}
                      <span className="font-mono">
                        {(
                          item.isbn13 ||
                          item.isbn10 ||
                          item.edition_key
                        ).trim()}
                      </span>
                    </p>
                  </div>
                  <div className="mt-auto pt-1">
                    {item.imported_edition_id ? (
                      <Button
                        label="Use"
                        size="small"
                        className="h-9 w-24 self-end justify-center"
                        onClick={() =>
                          onUseImported(item.imported_edition_id as string)
                        }
                      />
                    ) : (
                      <Button
                        label="Use"
                        size="small"
                        className="h-9 w-24 self-end justify-center"
                        loading={importingEditionKey === item.edition_key}
                        onClick={() =>
                          onImportAndUse(item.edition_key, item.work_key)
                        }
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {items.length > pageSize ? (
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                label="Previous"
                size="small"
                text
                disabled={safePage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              />
              <p className="text-xs text-[var(--p-text-muted-color)]">
                {safePage} / {totalPages}
              </p>
              <Button
                label="Next"
                size="small"
                text
                disabled={safePage >= totalPages}
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
              />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-[var(--p-text-muted-color)]">
          No Open Library editions loaded yet.
        </p>
      )}
    </div>
  );
}
