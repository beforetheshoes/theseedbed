import { OauthConsentPageClient } from "@/components/pages/oauth-consent-page";

export const dynamic = "force-dynamic";

export default async function OauthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const authorizationId =
    typeof resolved.authorization_id === "string"
      ? resolved.authorization_id
      : "";

  const query = new URLSearchParams();
  Object.entries(resolved).forEach(([key, value]) => {
    if (typeof value === "string") {
      query.set(key, value);
    }
  });

  const returnTo = `/oauth/consent${query.toString() ? `?${query.toString()}` : ""}`;

  return (
    <OauthConsentPageClient
      authorizationId={authorizationId}
      returnTo={returnTo}
    />
  );
}
