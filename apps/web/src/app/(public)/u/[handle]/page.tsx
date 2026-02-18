import { notFound } from "next/navigation";

const HANDLE_PATTERN = /^[A-Za-z0-9._-]+$/;

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: rawHandle } = await params;
  const handle = rawHandle.trim();
  if (!handle || !HANDLE_PATTERN.test(handle)) {
    notFound();
  }

  return (
    <section
      className="rounded-xl border border-[var(--p-content-border-color)] bg-[var(--surface-card)] p-6"
      data-test="public-profile-card"
    >
      <h1
        className="text-2xl font-semibold tracking-tight"
        data-test="public-profile-title"
      >
        Public profile
      </h1>
      <p className="mt-2 text-sm text-[var(--p-text-muted-color)]">
        Reserved for federation and public profile pages.
      </p>
      <p className="mt-3 text-sm">
        Handle:{" "}
        <span className="font-mono" data-test="public-profile-handle">
          {handle}
        </span>
      </p>
    </section>
  );
}
