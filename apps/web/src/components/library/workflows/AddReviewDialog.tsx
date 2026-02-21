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
  rating: string;
  saving: boolean;
  onHide: () => void;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onVisibilityChange: (value: "private" | "public") => void;
  onRatingChange: (value: string) => void;
  onSubmit: () => void;
};

function HalfStarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (starValue: number) => void;
}) {
  return (
    <span
      className="flex items-center gap-1 leading-none"
      role="slider"
      aria-label="Rating"
      aria-valuenow={Math.round(value * 2)}
      aria-valuemin={0}
      aria-valuemax={10}
    >
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span
            key={i}
            className="relative inline-block cursor-pointer text-[2rem] leading-none transition-transform hover:scale-110"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const isLeftHalf = event.clientX - rect.left < rect.width / 2;
              const newValue = isLeftHalf ? i + 0.5 : i + 1;
              onChange(newValue === value ? 0 : newValue);
            }}
          >
            <i
              className="pi pi-star"
              style={{ color: "var(--p-text-muted-color)", opacity: 0.3 }}
            />
            {fill > 0 ? (
              <i
                className="pi pi-star-fill absolute inset-0"
                style={{
                  color: "var(--p-primary-color)",
                  clipPath: `inset(0 ${(1 - fill) * 100}% 0 0)`,
                }}
              />
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

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
        <div className="grid items-center gap-2 sm:grid-cols-[auto_auto_12.5rem]">
          <div className="grid grid-rows-[1fr_auto] items-center px-1 py-1">
            <div className="flex items-center justify-center self-center">
              <HalfStarRating
                value={Number.parseFloat(rating || "0") || 0}
                onChange={(value) => onRatingChange(String(value))}
              />
            </div>
            <span className="text-center text-sm leading-none text-[var(--p-text-muted-color)]">
              Rating
            </span>
          </div>
          <div className="flex justify-center">
            <SelectButton
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
          </div>
          <Button label="Save review" loading={saving} onClick={onSubmit} />
        </div>
      </div>
    </Dialog>
  );
}
