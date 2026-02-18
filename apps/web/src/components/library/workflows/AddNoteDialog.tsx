"use client";

import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputTextarea } from "primereact/inputtextarea";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

type Props = {
  visible: boolean;
  headerTitle: string;
  workflowError: string;
  title: string;
  body: string;
  visibility: "private" | "public";
  saving: boolean;
  onHide: () => void;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onVisibilityChange: (value: "private" | "public") => void;
  onSubmit: () => void;
};

export function AddNoteDialog({
  visible,
  headerTitle,
  workflowError,
  title,
  body,
  visibility,
  saving,
  onHide,
  onTitleChange,
  onBodyChange,
  onVisibilityChange,
  onSubmit,
}: Props) {
  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      className="w-full max-w-[36rem]"
      header={headerTitle}
      modal
      draggable={false}
      data-test="library-workflow-add-note-dialog"
    >
      <div className="flex flex-col gap-3">
        {workflowError ? (
          <Message severity="error" text={workflowError} />
        ) : null}
        <InputText
          value={title}
          placeholder="Title (optional)"
          onChange={(event) => onTitleChange(event.target.value)}
        />
        <InputTextarea
          rows={5}
          autoResize
          value={body}
          placeholder="Write a note"
          onChange={(event) => onBodyChange(event.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <Dropdown
            value={visibility}
            options={[
              { label: "Private", value: "private" },
              { label: "Public", value: "public" },
            ]}
            optionLabel="label"
            optionValue="value"
            onChange={(event) =>
              onVisibilityChange(event.value as "private" | "public")
            }
          />
          <Button
            label="Add note"
            loading={saving}
            disabled={!body.trim()}
            onClick={onSubmit}
          />
        </div>
      </div>
    </Dialog>
  );
}
