import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function createBrowserClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (typeof window === "undefined") {
      // Build/prerender phase can execute client components on the server.
      // Return a placeholder client there and keep strict env validation in browser runtime.
      client = createSupabaseBrowserClient(
        "http://127.0.0.1:54321",
        "placeholder-anon-key",
      );
      return client;
    }
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  client = createSupabaseBrowserClient(url, key);
  return client;
}
