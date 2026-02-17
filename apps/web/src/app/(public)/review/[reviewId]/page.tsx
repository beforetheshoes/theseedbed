export default async function PublicReviewPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;

  return (
    <section
      className="rounded-xl border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-6"
      data-test="public-review-card"
    >
      <h1
        className="text-2xl font-semibold tracking-tight"
        data-test="public-review-title"
      >
        Public review
      </h1>
      <p className="mt-2 text-sm text-[var(--p-text-muted-color)]">
        Reserved canonical URL for public reviews.
      </p>
      <p className="mt-3 text-sm">
        Review ID:{" "}
        <span className="font-mono" data-test="public-review-id">
          {reviewId}
        </span>
      </p>
    </section>
  );
}
