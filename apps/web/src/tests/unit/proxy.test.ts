import type { User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateSessionMock } = vi.hoisted(() => ({
  updateSessionMock: vi.fn(),
}));

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: updateSessionMock,
}));

import { config, proxy } from "../../proxy";

const MATCHER =
  "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)";

function requestFor(path: string, headers?: HeadersInit) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

describe("proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps matcher configuration unchanged", () => {
    expect(config).toEqual({ matcher: [MATCHER] });
  });

  it("returns ActivityPub placeholder for profile routes", async () => {
    const response = await proxy(
      requestFor("/u/test-user", { accept: "application/activity+json" }),
    );

    expect(response.status).toBe(406);
    await expect(response.json()).resolves.toEqual({
      message: "ActivityPub is not implemented yet.",
    });
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it("redirects authenticated users away from /login", async () => {
    const passthroughResponse = NextResponse.next();
    updateSessionMock.mockResolvedValue({
      response: passthroughResponse,
      user: { id: "user-1" } as User,
    });

    const response = await proxy(requestFor("/login"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/library");
  });

  it("redirects unauthenticated protected routes in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const passthroughResponse = NextResponse.next();
    updateSessionMock.mockResolvedValue({
      response: passthroughResponse,
      user: null,
    });

    const response = await proxy(requestFor("/library?page=2"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?returnTo=%2Flibrary%3Fpage%3D2",
    );
  });

  it("does not redirect unauthenticated protected routes in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const passthroughResponse = NextResponse.next();
    updateSessionMock.mockResolvedValue({
      response: passthroughResponse,
      user: null,
    });

    const response = await proxy(requestFor("/library"));

    expect(response).toBe(passthroughResponse);
  });

  it("returns passthrough response for non-protected routes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const passthroughResponse = NextResponse.next();
    updateSessionMock.mockResolvedValue({
      response: passthroughResponse,
      user: null,
    });

    const response = await proxy(requestFor("/book/test-work"));

    expect(response).toBe(passthroughResponse);
    expect(updateSessionMock).toHaveBeenCalledOnce();
  });
});
