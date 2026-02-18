import type { SupabaseClient } from "@supabase/supabase-js";

type Envelope<T> = {
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown> | null;
  } | null;
};

export class ApiClientError extends Error {
  code: string;
  status?: number;

  constructor(message: string, code: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function getApiBaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof value === "string" && value.trim()) {
    return value.replace(/\/$/, "");
  }

  return "http://localhost:8000";
}

export async function getAccessToken(
  supabase: SupabaseClient | null,
): Promise<string> {
  if (!supabase) {
    throw new ApiClientError(
      "Sign in is required to use the API.",
      "auth_required",
      401,
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const token = session?.access_token;
  if (!token) {
    throw new ApiClientError(
      "Sign in is required to use the API.",
      "auth_required",
      401,
    );
  }

  return token;
}

export async function apiRequest<T>(
  supabase: SupabaseClient | null,
  path: string,
  options?: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    query?: Record<string, string | number | undefined | null>;
    body?: unknown;
    signal?: AbortSignal;
  },
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const token = await getAccessToken(supabase);

  const isFormData =
    typeof FormData !== "undefined" && options?.body instanceof FormData;

  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    method: options?.method ?? "GET",
    signal: options?.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
    },
    body: options?.body
      ? isFormData
        ? (options.body as FormData)
        : JSON.stringify(options.body)
      : undefined,
  });

  // Handle 204 No Content or empty body responses
  const text = await response.text();
  if (!response.ok) {
    let errorMessage = "Request failed.";
    let errorCode = "request_failed";
    if (text) {
      try {
        const parsed = JSON.parse(text) as Envelope<T>;
        errorMessage = parsed.error?.message ?? errorMessage;
        errorCode = parsed.error?.code ?? errorCode;
      } catch {
        // Non-JSON error body
      }
    }
    throw new ApiClientError(errorMessage, errorCode, response.status);
  }

  if (!text) {
    return undefined as T;
  }

  const payload = JSON.parse(text) as Envelope<T>;
  if (payload.error) {
    throw new ApiClientError(
      payload.error.message ?? "Request failed.",
      payload.error.code ?? "request_failed",
      response.status,
    );
  }

  if (payload.data === null || payload.data === undefined) {
    return undefined as T;
  }

  return payload.data;
}
