import { describe, expect, it } from "vitest";
import {
  isProtectedPath,
  loginRedirectPath,
  wantsActivityPub,
} from "@/lib/auth-routes";

describe("auth route helpers", () => {
  it("matches protected paths", () => {
    expect(isProtectedPath("/library")).toBe(true);
    expect(isProtectedPath("/library/anything")).toBe(true);
    expect(isProtectedPath("/books/search")).toBe(true);
    expect(isProtectedPath("/settings")).toBe(true);
    expect(isProtectedPath("/book/abc")).toBe(false);
    expect(isProtectedPath("/u/reader")).toBe(false);
  });

  it("builds login redirect with encoded returnTo", () => {
    expect(loginRedirectPath("/library", "?page=2")).toBe(
      "/login?returnTo=%2Flibrary%3Fpage%3D2",
    );
  });

  it("detects activitypub accept headers", () => {
    expect(wantsActivityPub("text/html")).toBe(false);
    expect(wantsActivityPub("application/activity+json")).toBe(true);
    expect(wantsActivityPub("application/activity+json, text/html")).toBe(true);
  });
});
