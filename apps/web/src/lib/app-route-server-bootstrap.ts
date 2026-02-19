import { ApiClientError, getAccessToken } from "@/lib/api";
import { createServerClient } from "@/lib/supabase/server";

export type AppRouteServerBootstrapResult =
  | { kind: "authed"; accessToken: string }
  | { kind: "unauthenticated" };

export async function bootstrapAppRouteAccessToken(): Promise<AppRouteServerBootstrapResult> {
  const supabase = await createServerClient();

  try {
    const accessToken = await getAccessToken(supabase);
    return { kind: "authed", accessToken };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      return { kind: "unauthenticated" };
    }
    throw error;
  }
}
