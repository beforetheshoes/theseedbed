import { Card } from "primereact/card";

interface EmptyStateProps {
  title: string;
  body?: string;
  icon?: string;
  "data-test"?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  title,
  body,
  icon,
  "data-test": dataTest,
  action,
}: EmptyStateProps) {
  return (
    <Card data-test={dataTest}>
      <div className="flex items-start gap-4">
        {icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--highlight-bg)] text-[var(--p-primary-color)]">
            <i className={icon} aria-hidden="true" />
          </div>
        ) : null}
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          {body ? (
            <p className="mt-1 text-sm text-[var(--p-text-muted-color)]">
              {body}
            </p>
          ) : null}
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </div>
    </Card>
  );
}
