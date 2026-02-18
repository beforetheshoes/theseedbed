import { afterEach, describe, expect, it } from "vitest";
import { buildImageRemotePatterns } from "@/lib/image-remote-patterns";
import {
  isConfiguredRemoteImageUrl,
  shouldUseUnoptimizedForUrl,
} from "@/lib/image-optimization";

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

describe("shouldUseUnoptimizedForUrl", () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  });

  it("allows open library covers through next/image optimization", () => {
    expect(
      shouldUseUnoptimizedForUrl(
        "https://covers.openlibrary.org/b/id/1234-M.jpg",
      ),
    ).toBe(false);
  });

  it("allows google books and googleusercontent covers", () => {
    expect(
      shouldUseUnoptimizedForUrl(
        "https://books.google.com/books/content?id=abc123&printsec=frontcover",
      ),
    ).toBe(false);
    expect(
      shouldUseUnoptimizedForUrl(
        "https://lh3.googleusercontent.com/books/content?p=abc123",
      ),
    ).toBe(false);
    expect(
      shouldUseUnoptimizedForUrl(
        "https://books.google.com/books/content/volume?id=abc123",
      ),
    ).toBe(false);
  });

  it("allows known hosted supabase storage URLs", () => {
    expect(
      shouldUseUnoptimizedForUrl(
        "https://kypwcksvicrbrrwscdze.supabase.co/storage/v1/object/public/covers/a.jpg",
      ),
    ).toBe(false);
  });

  it("uses unoptimized for localhost storage URLs", () => {
    expect(
      shouldUseUnoptimizedForUrl(
        "http://localhost:54321/storage/v1/object/public/covers/a.jpg",
      ),
    ).toBe(true);
    expect(
      shouldUseUnoptimizedForUrl(
        "http://127.0.0.1:55421/storage/v1/object/public/covers/a.jpg",
      ),
    ).toBe(true);
  });

  it("allows storage host derived from NEXT_PUBLIC_SUPABASE_URL", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://custom.supabase.local";
    expect(
      shouldUseUnoptimizedForUrl(
        "https://custom.supabase.local/storage/v1/object/public/covers/a.jpg",
      ),
    ).toBe(false);
  });

  it("falls back to unoptimized for unknown hosts", () => {
    expect(
      shouldUseUnoptimizedForUrl("https://legacy-cdn.example.com/covers/a.jpg"),
    ).toBe(true);
  });

  it("falls back to unoptimized when host matches but port does not", () => {
    expect(
      shouldUseUnoptimizedForUrl(
        "http://localhost:9999/storage/v1/object/public/covers/a.jpg",
      ),
    ).toBe(true);
  });

  it("falls back to unoptimized for invalid URLs", () => {
    expect(shouldUseUnoptimizedForUrl("not-a-url")).toBe(true);
  });

  it("falls back to unoptimized for unsupported schemes", () => {
    expect(shouldUseUnoptimizedForUrl("data:image/png;base64,xyz")).toBe(true);
  });
});

describe("buildImageRemotePatterns", () => {
  it("deduplicates entries when env host matches static host rules", () => {
    const patterns = buildImageRemotePatterns(
      "https://kypwcksvicrbrrwscdze.supabase.co",
    );
    const hosted = patterns.filter(
      (pattern) =>
        pattern.hostname === "kypwcksvicrbrrwscdze.supabase.co" &&
        pattern.pathname === "/storage/v1/object/public/**" &&
        pattern.protocol === "https",
    );
    expect(hosted).toHaveLength(1);
  });

  it("parses http supabase hosts including explicit port", () => {
    const patterns = buildImageRemotePatterns("http://custom.local:5999");
    expect(patterns).toContainEqual(
      expect.objectContaining({
        protocol: "http",
        hostname: "custom.local",
        port: "5999",
        pathname: "/storage/v1/object/public/**",
      }),
    );
  });

  it("ignores invalid supabase URL input", () => {
    const patterns = buildImageRemotePatterns("not-a-url");
    expect(patterns.some((pattern) => pattern.hostname === "not-a-url")).toBe(
      false,
    );
  });

  it("accepts a missing supabase URL", () => {
    const patterns = buildImageRemotePatterns(undefined);
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("matches google books content path exactly", () => {
    const patterns = buildImageRemotePatterns(undefined);
    expect(
      patterns.some(
        (pattern) =>
          pattern.hostname === "books.google.com" &&
          pattern.pathname === "/books/content",
      ),
    ).toBe(true);
  });
});

describe("isConfiguredRemoteImageUrl", () => {
  it("returns false for invalid URL input", () => {
    expect(isConfiguredRemoteImageUrl("not-a-url")).toBe(false);
  });

  it("applies explicit local port matching from remote patterns", () => {
    expect(
      isConfiguredRemoteImageUrl(
        "http://127.0.0.1:55421/storage/v1/object/public/covers/a.jpg",
      ),
    ).toBe(true);
    expect(
      isConfiguredRemoteImageUrl(
        "http://127.0.0.1:5999/storage/v1/object/public/covers/a.jpg",
      ),
    ).toBe(false);
  });
});
