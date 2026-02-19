import { ApiClientError, apiRequestWithAccessToken } from "@/lib/api";
import { bootstrapAppRouteAccessToken } from "@/lib/app-route-server-bootstrap";
import SettingsPageClient, { type MeProfile } from "./settings-page-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const auth = await bootstrapAppRouteAccessToken();

  if (auth.kind !== "authed") {
    return (
      <SettingsPageClient initialError="Sign in is required to use settings." />
    );
  }

  let initialProfile: MeProfile | undefined;
  let initialError: string | undefined;

  try {
    initialProfile = await apiRequestWithAccessToken<MeProfile>(
      auth.accessToken,
      "/api/v1/me",
    );
  } catch (error) {
    initialError =
      error instanceof ApiClientError
        ? error.message
        : "Unable to load settings.";
  }

  return (
    <SettingsPageClient
      initialProfile={initialProfile}
      initialError={initialError}
    />
  );
}
