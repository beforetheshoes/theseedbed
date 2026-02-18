"use client";

import { type ReactNode } from "react";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { SelectButton } from "primereact/selectbutton";
import type { Edition } from "@/components/library/workflows/types";

type Props = {
  visible: boolean;
  headerTitle: string;
  workflowError: string;
  coverBusy: boolean;
  coverMode: "choose" | "upload" | "url";
  workflowEditions: Edition[];
  workflowEditionId: string;
  coverSourceUrl: string;
  hasSelectedFile: boolean;
  canEditEditionTarget: boolean;
  editionResolver?: ReactNode;
  onHide: () => void;
  onCoverModeChange: (mode: "choose" | "upload" | "url") => void;
  onFileChange: (file: File | null) => void;
  onUploadCover: () => void;
  onCoverSourceUrlChange: (value: string) => void;
  onCacheCover: () => void;
};

export function SetCoverDialog({
  visible,
  headerTitle,
  workflowError,
  coverBusy,
  coverMode,
  workflowEditions,
  workflowEditionId,
  coverSourceUrl,
  hasSelectedFile,
  canEditEditionTarget,
  editionResolver,
  onHide,
  onCoverModeChange,
  onFileChange,
  onUploadCover,
  onCoverSourceUrlChange,
  onCacheCover,
}: Props) {
  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      className="w-full max-w-[80rem]"
      header={headerTitle}
      modal
      draggable={false}
      data-test="library-workflow-set-cover-dialog"
    >
      <div className="flex flex-col gap-4">
        {workflowError ? (
          <Message severity="error" text={workflowError} />
        ) : null}

        <SelectButton
          value={coverMode}
          options={[
            { label: "Choose edition", value: "choose" },
            { label: "Upload", value: "upload" },
            { label: "URL", value: "url" },
          ]}
          optionLabel="label"
          optionValue="value"
          onChange={(event) =>
            onCoverModeChange(event.value as "choose" | "upload" | "url")
          }
        />

        {coverMode === "choose" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[var(--p-text-muted-color)]">
              Choose one edition and click <strong>Use</strong> to apply its
              cover.
            </p>
            {editionResolver}
          </div>
        ) : null}

        {coverMode === "upload" ? (
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
            {!canEditEditionTarget ? (
              <p className="text-xs text-[var(--p-text-muted-color)]">
                Upload needs a resolvable edition target.
              </p>
            ) : null}
          </div>
        ) : null}

        {coverMode === "url" ? (
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
            {!canEditEditionTarget ? (
              <p className="text-xs text-[var(--p-text-muted-color)]">
                URL cache needs a resolvable edition target.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
