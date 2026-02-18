"use client";

import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputTextarea } from "primereact/inputtextarea";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

type ProgressUnit = "pages_read" | "percent_complete" | "minutes_listened";

type Props = {
  visible: boolean;
  headerTitle: string;
  workflowError: string;
  progressUnit: ProgressUnit;
  progressValue: string;
  progressDate: string;
  progressNote: string;
  progressSaving: boolean;
  onHide: () => void;
  onProgressUnitChange: (unit: ProgressUnit) => void;
  onProgressValueChange: (value: string) => void;
  onProgressDateChange: (value: string) => void;
  onProgressNoteChange: (value: string) => void;
  onSubmit: () => void;
};

export function LogProgressDialog({
  visible,
  headerTitle,
  workflowError,
  progressUnit,
  progressValue,
  progressDate,
  progressNote,
  progressSaving,
  onHide,
  onProgressUnitChange,
  onProgressValueChange,
  onProgressDateChange,
  onProgressNoteChange,
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
      data-test="library-workflow-log-progress-dialog"
    >
      <div className="flex flex-col gap-3">
        {workflowError ? (
          <Message severity="error" text={workflowError} />
        ) : null}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Dropdown
            value={progressUnit}
            options={[
              { label: "Pages", value: "pages_read" },
              { label: "Percent", value: "percent_complete" },
              { label: "Time", value: "minutes_listened" },
            ]}
            optionLabel="label"
            optionValue="value"
            onChange={(event) =>
              onProgressUnitChange(event.value as ProgressUnit)
            }
          />
          <InputText
            value={progressValue}
            placeholder="Progress value"
            onChange={(event) => onProgressValueChange(event.target.value)}
          />
          <Calendar
            value={progressDate ? new Date(`${progressDate}T00:00:00`) : null}
            maxDate={new Date()}
            showIcon
            dateFormat="mm/dd/yy"
            onChange={(event) => {
              if (event.value instanceof Date) {
                onProgressDateChange(event.value.toISOString().slice(0, 10));
              }
            }}
          />
        </div>
        <InputTextarea
          rows={4}
          autoResize
          value={progressNote}
          placeholder="Session note (optional)"
          onChange={(event) => onProgressNoteChange(event.target.value)}
        />
        <div className="flex justify-end">
          <Button
            label="Log progress"
            loading={progressSaving}
            onClick={onSubmit}
          />
        </div>
      </div>
    </Dialog>
  );
}
