"use client";

import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { SelectButton } from "primereact/selectbutton";

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
        <div className="grid items-center gap-2 sm:grid-cols-[auto_12rem]">
          <div className="flex justify-center sm:justify-start">
            <SelectButton
              value={visibility}
              options={[
                { label: "Private", value: "private" },
                { label: "Public", value: "public" },
              ]}
              optionLabel="label"
              optionValue="value"
              className="h-[3rem] [&_.p-button]:h-full [&_.p-button]:px-4"
              onChange={(event) =>
                onVisibilityChange(event.value as "private" | "public")
              }
            />
          </div>
          <Button
            className="h-[3rem]"
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
