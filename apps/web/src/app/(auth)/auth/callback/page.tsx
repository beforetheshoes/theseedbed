import { AuthCallbackPageClient } from "@/components/pages/auth-callback-page";

export const dynamic = "force-dynamic";

function buildOauthError(
  query: Record<string, string | string[] | undefined>,
): string {
  const code = typeof query.error === "string" ? query.error : "";
  const description =
    typeof query.error_description === "string" ? query.error_description : "";
  if (description) return description;
  if (code) return `Authentication failed (${code}).`;
  return "";
}

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const returnToRaw = resolved.returnTo;
  const returnToFromQuery = typeof returnToRaw === "string" ? returnToRaw : "";
  const oauthError = buildOauthError(resolved);

  return (
    <AuthCallbackPageClient
      oauthError={oauthError}
      returnToFromQuery={returnToFromQuery}
    />
  );
}
