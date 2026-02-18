"use client";

import { useMemo, useState } from "react";
import { Avatar } from "primereact/avatar";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputTextarea } from "primereact/inputtextarea";
import { Knob } from "primereact/knob";
import { Message } from "primereact/message";
import { Slider } from "primereact/slider";
import { Tag } from "primereact/tag";
import {
  fromCanonicalPercent,
  toCanonicalPercent,
  type ProgressTotals,
} from "@/lib/progress-conversion";

type ProgressUnit = "pages_read" | "percent_complete" | "minutes_listened";

type Props = {
  visible: boolean;
  headerTitle: string;
  workflowError: string;
  statisticsLoading: boolean;
  progressTotals: ProgressTotals;
  streakDays: number;
  progressUnit: ProgressUnit;
  progressValue: string;
  progressDate: string;
  progressNote: string;
  progressSaving: boolean;
  onHide: () => void;
  onRetryStatistics: () => void;
  onProgressUnitChange: (unit: ProgressUnit) => void;
  onProgressValueChange: (value: string) => void;
  onProgressDateChange: (value: string) => void;
  onProgressNoteChange: (value: string) => void;
  onSubmit: () => void;
};

const formatDuration = (minutesValue: number): string => {
  const safe =
    Number.isFinite(minutesValue) && minutesValue >= 0 ? minutesValue : 0;
  const totalMinutes = Math.round(safe);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:00`;
};

export function LogProgressDialog({
  visible,
  headerTitle,
  workflowError,
  statisticsLoading,
  progressTotals,
  streakDays,
  progressUnit,
  progressValue,
  progressDate,
  progressNote,
  progressSaving,
  onHide,
  onRetryStatistics,
  onProgressUnitChange,
  onProgressValueChange,
  onProgressDateChange,
  onProgressNoteChange,
  onSubmit,
}: Props) {
  const [showConvertUnitSelect, setShowConvertUnitSelect] = useState(false);
  const parsedProgressValue = Number(progressValue.trim());
  const currentNumeric =
    Number.isFinite(parsedProgressValue) && parsedProgressValue >= 0
      ? parsedProgressValue
      : 0;
  const canonicalPercent = useMemo(
    () => toCanonicalPercent(progressUnit, currentNumeric, progressTotals) ?? 0,
    [currentNumeric, progressTotals, progressUnit],
  );
  const displayPagesValue = Math.round(
    fromCanonicalPercent("pages_read", canonicalPercent, progressTotals) ?? 0,
  );
  const displayPercentValue = Math.round(
    fromCanonicalPercent(
      "percent_complete",
      canonicalPercent,
      progressTotals,
    ) ?? 0,
  );
  const displayMinutesValue = Math.round(
    fromCanonicalPercent(
      "minutes_listened",
      canonicalPercent,
      progressTotals,
    ) ?? 0,
  );
  const sliderMax = useMemo(() => {
    if (progressUnit === "percent_complete") return 100;
    if (progressUnit === "pages_read")
      return Math.max(progressTotals.total_pages ?? 1000, 1);
    return Math.max(progressTotals.total_audio_minutes ?? 1440, 1);
  }, [
    progressTotals.total_audio_minutes,
    progressTotals.total_pages,
    progressUnit,
  ]);
  const totalsTimeDisplay = formatDuration(
    progressTotals.total_audio_minutes ?? 0,
  );

  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      className="w-full max-w-[60rem]"
      header={headerTitle}
      modal
      draggable={false}
      data-test="library-workflow-log-progress-dialog"
    >
      <div className="flex flex-col gap-4">
        {workflowError ? (
          <Message severity="error" text={workflowError} />
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar icon="pi pi-clock" shape="circle" aria-hidden="true" />
            <p className="m-0 font-heading text-lg font-semibold tracking-tight">
              Reading sessions
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="small"
              severity="secondary"
              disabled={statisticsLoading}
              onClick={onRetryStatistics}
            >
              Retry
            </Button>
            {!showConvertUnitSelect ? (
              <Button
                outlined
                size="small"
                severity="secondary"
                onClick={() => setShowConvertUnitSelect(true)}
              >
                Convert progress unit
              </Button>
            ) : (
              <Dropdown
                value={progressUnit}
                options={[
                  { label: "Pages", value: "pages_read" },
                  { label: "Percentage", value: "percent_complete" },
                  { label: "Time", value: "minutes_listened" },
                ]}
                optionLabel="label"
                optionValue="value"
                onChange={(event) => {
                  onProgressUnitChange(event.value as ProgressUnit);
                  setShowConvertUnitSelect(false);
                }}
              />
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--p-content-border-color)] p-4">
          <div className="mx-auto flex w-[300px] max-w-full flex-col items-center gap-4">
            <div className="relative h-[210px] w-[210px]">
              <Knob
                value={Math.max(0, Math.min(100, canonicalPercent))}
                min={0}
                max={100}
                readOnly
                size={210}
                showValue={false}
                strokeWidth={14}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-3xl font-semibold">
                  {displayPercentValue}%
                </span>
              </div>
            </div>
            <Slider
              className="w-full"
              min={0}
              max={sliderMax}
              step={1}
              value={Math.max(0, Math.round(currentNumeric))}
              onChange={(event) =>
                onProgressValueChange(String((event.value as number) ?? 0))
              }
            />
            <p className="text-xs text-[var(--p-text-muted-color)]">
              Pages: {displayPagesValue} • Percentage: {displayPercentValue}% •
              Time: {formatDuration(displayMinutesValue)}
            </p>
            <Tag value={`${streakDays}-day streak`} severity="info" />
            <div className="flex flex-col items-center gap-1">
              <label className="text-xs font-medium">Log date</label>
              <Calendar
                value={
                  progressDate ? new Date(`${progressDate}T00:00:00`) : null
                }
                maxDate={new Date()}
                showIcon
                dateFormat="mm/dd/yy"
                onChange={(event) => {
                  if (event.value instanceof Date) {
                    onProgressDateChange(
                      event.value.toISOString().slice(0, 10),
                    );
                  }
                }}
              />
            </div>
            <InputTextarea
              className="w-full max-w-[500px]"
              rows={5}
              autoResize
              value={progressNote}
              placeholder="Session note"
              onChange={(event) => onProgressNoteChange(event.target.value)}
            />
            <Button
              label="Log session"
              loading={progressSaving}
              onClick={onSubmit}
            />
          </div>
        </div>

        <div className="flex flex-col items-center gap-0 text-sm">
          <p className="m-0 font-medium">Totals</p>
          <p className="m-0 text-xs text-[var(--p-text-muted-color)]">
            Pages: {progressTotals.total_pages ?? 0} • Time: {totalsTimeDisplay}
          </p>
        </div>

        {statisticsLoading ? (
          <div className="flex justify-center">
            <small className="text-[var(--p-text-muted-color)]">
              Loading reading statistics...
            </small>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
