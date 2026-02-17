interface CoverPlaceholderProps {
  className?: string;
  "data-test"?: string;
}

export function CoverPlaceholder({
  className,
  "data-test": dataTest = "cover-placeholder",
}: CoverPlaceholderProps) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-1 text-[var(--p-text-muted-color)] ${className ?? ""}`}
      role="img"
      aria-label="No cover"
      data-test={dataTest}
    >
      <i className="pi pi-book text-lg" aria-hidden="true" />
      <span className="text-xs font-medium">No cover</span>
    </div>
  );
}
