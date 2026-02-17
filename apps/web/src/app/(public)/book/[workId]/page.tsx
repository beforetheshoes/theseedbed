export default async function PublicBookPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const { workId } = await params;

  return (
    <section
      className="rounded-xl border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-6"
      data-test="public-book-card"
    >
      <h1
        className="text-2xl font-semibold tracking-tight"
        data-test="public-book-title"
      >
        Public book page
      </h1>
      <p className="mt-2 text-sm text-[var(--p-text-muted-color)]">
        Reserved canonical URL for public book pages.
      </p>
      <p className="mt-3 text-sm">
        Work ID:{" "}
        <span className="font-mono" data-test="public-book-work-id">
          {workId}
        </span>
      </p>
    </section>
  );
}
