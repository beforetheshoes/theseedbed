"use client";

import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputTextarea } from "primereact/inputtextarea";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Rating } from "primereact/rating";

type Props = {
  visible: boolean;
  headerTitle: string;
  workflowError: string;
  title: string;
  body: string;
  visibility: "private" | "public";
  rating: string;
  saving: boolean;
  onHide: () => void;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onVisibilityChange: (value: "private" | "public") => void;
  onRatingChange: (value: string) => void;
  onSubmit: () => void;
};

export function AddReviewDialog({
  visible,
  headerTitle,
  workflowError,
  title,
  body,
  visibility,
  rating,
  saving,
  onHide,
  onTitleChange,
  onBodyChange,
  onVisibilityChange,
  onRatingChange,
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
      data-test="library-workflow-add-review-dialog"
    >
      <div className="flex flex-col gap-3">
        {workflowError ? (
          <Message severity="error" text={workflowError} />
        ) : null}
        <InputText
          value={title}
          placeholder="Review title"
          onChange={(event) => onTitleChange(event.target.value)}
        />
        <InputTextarea
          rows={6}
          autoResize
          value={body}
          placeholder="Write your review"
          onChange={(event) => onBodyChange(event.target.value)}
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <Rating
            value={Number.parseFloat(rating || "0") || 0}
            stars={5}
            cancel
            onChange={(event) =>
              onRatingChange(String((event.value as number) ?? 0))
            }
          />
          <Dropdown
            value={visibility}
            options={[
              { label: "Private", value: "private" },
              { label: "Public", value: "public" },
            ]}
            optionLabel="label"
            optionValue="value"
            onChange={(event) =>
              onVisibilityChange(
                event.value === "public" ? "public" : "private",
              )
            }
          />
          <Button label="Save review" loading={saving} onClick={onSubmit} />
        </div>
      </div>
    </Dialog>
  );
}
