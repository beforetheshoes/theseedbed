import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ApiClientError,
  apiRequest,
  getAccessToken,
  getApiBaseUrl,
} from "@/lib/api";

const fetchMock = vi.fn();

/** Helper to build a minimal Response-like object that apiRequest expects. */
function mockResponse(
  body: unknown,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {},
) {
  const text = body === null || body === undefined ? "" : JSON.stringify(body);
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(text),
  };
}

describe("api helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
  });

  it("uses default local api base", () => {
    expect(getApiBaseUrl()).toBe("http://localhost:8000");
  });

  it("uses NEXT_PUBLIC_API_BASE_URL when set", () => {
    const previous = process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.com/";
    expect(getApiBaseUrl()).toBe("https://api.example.com");
    if (previous) {
      process.env.NEXT_PUBLIC_API_BASE_URL = previous;
    } else {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    }
  });

  it("throws auth_required without supabase", async () => {
    await expect(getAccessToken(null)).rejects.toEqual(
      expect.objectContaining({ code: "auth_required", status: 401 }),
    );
  });

  it("throws auth_required when session token is missing", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      },
    } as unknown as SupabaseClient;

    await expect(getAccessToken(supabase)).rejects.toEqual(
      expect.objectContaining({ code: "auth_required", status: 401 }),
    );
  });

  it("sends request with auth header and query", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-123" } },
        }),
      },
    } as unknown as SupabaseClient;

    fetchMock.mockResolvedValue(
      mockResponse({ data: { id: "1" }, error: null }),
    );

    const data = await apiRequest<{ id: string }>(supabase, "/api/v1/me", {
      query: { page: 2, filter: "", include: undefined, q: null },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/me?page=2"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer token-123" }),
      }),
    );
    expect(data.id).toBe("1");
  });

  it("sends form data without content-type override", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-123" } },
        }),
      },
    } as unknown as SupabaseClient;

    const formData = new FormData();
    formData.append("file", new Blob(["x"]), "x.txt");

    fetchMock.mockResolvedValue(
      mockResponse({ data: { ok: true }, error: null }),
    );

    await apiRequest<{ ok: boolean }>(supabase, "/api/v1/upload", {
      method: "POST",
      body: formData,
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-123");
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("throws request_failed on non-ok response", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-123" } },
        }),
      },
    } as unknown as SupabaseClient;

    fetchMock.mockResolvedValue(
      mockResponse(
        { data: null, error: { code: "server_error", message: "boom" } },
        { ok: false, status: 500 },
      ),
    );

    await expect(apiRequest(supabase, "/api/v1/me")).rejects.toEqual(
      expect.objectContaining({
        message: "boom",
        code: "server_error",
        status: 500,
      }),
    );
  });

  it("throws request_failed defaults when response payload has no error object", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-123" } },
        }),
      },
    } as unknown as SupabaseClient;

    fetchMock.mockResolvedValue(
      mockResponse(
        { data: null, error: null },
        { ok: false, status: 503 },
      ),
    );

    await expect(apiRequest(supabase, "/api/v1/me")).rejects.toEqual(
      expect.objectContaining({
        message: "Request failed.",
        code: "request_failed",
        status: 503,
      }),
    );
  });

  it("throws on ok response with error in payload", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-123" } },
        }),
      },
    } as unknown as SupabaseClient;

    fetchMock.mockResolvedValue(
      mockResponse(
        { data: null, error: { code: "bad_input", message: "nope" } },
        { ok: true, status: 400 },
      ),
    );

    await expect(apiRequest(supabase, "/api/v1/me")).rejects.toEqual(
      expect.objectContaining({
        message: "nope",
        code: "bad_input",
        status: 400,
      }),
    );
  });

  it("returns undefined for null data on ok response", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-123" } },
        }),
      },
    } as unknown as SupabaseClient;

    fetchMock.mockResolvedValue(
      mockResponse({ data: null, error: null }),
    );

    const result = await apiRequest(supabase, "/api/v1/me");
    expect(result).toBeUndefined();
  });

  it("returns undefined for 204 No Content", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-123" } },
        }),
      },
    } as unknown as SupabaseClient;

    fetchMock.mockResolvedValue(
      mockResponse(null, { ok: true, status: 204 }),
    );

    const result = await apiRequest(supabase, "/api/v1/resource");
    expect(result).toBeUndefined();
  });

  it("constructs ApiClientError correctly", () => {
    const error = new ApiClientError("Failure", "bad", 400);
    expect(error.message).toBe("Failure");
    expect(error.code).toBe("bad");
    expect(error.status).toBe(400);
  });
});
