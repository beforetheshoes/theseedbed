export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  return (
    <section
      className="rounded-xl border border-slate-300/60 bg-white/80 p-6"
      data-test="public-profile-card"
    >
      <h1
        className="text-2xl font-semibold tracking-tight"
        data-test="public-profile-title"
      >
        Public profile
      </h1>
      <p className="mt-2 text-sm text-slate-600">
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
