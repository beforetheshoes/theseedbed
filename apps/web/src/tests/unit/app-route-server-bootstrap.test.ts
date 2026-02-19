import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClientMock, getAccessTokenMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(async () => ({ auth: {} })),
  getAccessTokenMock: vi.fn(async () => "token-123"),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: createServerClientMock,
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getAccessToken: getAccessTokenMock,
  };
});

import { ApiClientError } from "@/lib/api";
import { bootstrapAppRouteAccessToken } from "@/lib/app-route-server-bootstrap";

describe("bootstrapAppRouteAccessToken", () => {
  beforeEach(() => {
    createServerClientMock.mockClear();
    getAccessTokenMock.mockReset();
    getAccessTokenMock.mockResolvedValue("token-123");
  });

  it("returns authed when token resolves", async () => {
    await expect(bootstrapAppRouteAccessToken()).resolves.toEqual({
      kind: "authed",
      accessToken: "token-123",
    });
    expect(createServerClientMock).toHaveBeenCalledTimes(1);
  });

  it("returns unauthenticated on 401", async () => {
    getAccessTokenMock.mockRejectedValueOnce(
      new ApiClientError("Sign in required", "auth_required", 401),
    );

    await expect(bootstrapAppRouteAccessToken()).resolves.toEqual({
      kind: "unauthenticated",
    });
  });

  it("rethrows non-401 errors", async () => {
    getAccessTokenMock.mockRejectedValueOnce(
      new ApiClientError("Server error", "request_failed", 500),
    );

    await expect(bootstrapAppRouteAccessToken()).rejects.toMatchObject({
      message: "Server error",
    });
  });
});
