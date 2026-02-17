import { describe, expect, it } from "vitest";
import {
  canConvert,
  fromCanonicalPercent,
  toCanonicalPercent,
} from "@/lib/progress-conversion";

describe("progress-conversion", () => {
  it("converts pages and minutes into canonical percent", () => {
    const totals = { total_pages: 400, total_audio_minutes: 800 };
    expect(toCanonicalPercent("pages_read", 200, totals)).toBe(50);
    expect(toCanonicalPercent("minutes_listened", 200, totals)).toBe(25);
  });

  it("converts canonical percent back to unit values", () => {
    const totals = { total_pages: 320, total_audio_minutes: 600 };
    expect(fromCanonicalPercent("pages_read", 50, totals)).toBe(160);
    expect(fromCanonicalPercent("minutes_listened", 50, totals)).toBe(300);
    expect(fromCanonicalPercent("percent_complete", 49.6, totals)).toBe(50);
  });

  it("reports missing totals for conversion requirements", () => {
    const missing = canConvert("pages_read", "minutes_listened", {
      total_pages: null,
      total_audio_minutes: null,
    });
    expect(missing.canConvert).toBe(false);
    expect(missing.missing).toContain("total_pages");
    expect(missing.missing).toContain("total_audio_minutes");
  });

  it("returns null for invalid canonical conversions and missing totals", () => {
    expect(
      toCanonicalPercent("percent_complete", Number.NaN, {
        total_pages: 100,
        total_audio_minutes: 200,
      }),
    ).toBeNull();
    expect(
      toCanonicalPercent("pages_read", -1, {
        total_pages: 100,
        total_audio_minutes: 200,
      }),
    ).toBeNull();
    expect(
      toCanonicalPercent("pages_read", 10, {
        total_pages: null,
        total_audio_minutes: 200,
      }),
    ).toBeNull();
    expect(
      toCanonicalPercent("minutes_listened", 10, {
        total_pages: 100,
        total_audio_minutes: null,
      }),
    ).toBeNull();
  });

  it("clamps out-of-range percent and handles NaN input for reverse conversion", () => {
    const totals = { total_pages: 100, total_audio_minutes: 120 };
    expect(fromCanonicalPercent("percent_complete", 150, totals)).toBe(100);
    expect(fromCanonicalPercent("percent_complete", -12, totals)).toBe(0);
    expect(fromCanonicalPercent("pages_read", Number.NaN, totals)).toBeNull();
    expect(
      fromCanonicalPercent("pages_read", 50, {
        total_pages: null,
        total_audio_minutes: 120,
      }),
    ).toBeNull();
    expect(
      fromCanonicalPercent("minutes_listened", 50, {
        total_pages: 100,
        total_audio_minutes: null,
      }),
    ).toBeNull();
  });

  it("supports same-unit conversion and single-missing requirements", () => {
    expect(
      canConvert("pages_read", "pages_read", {
        total_pages: null,
        total_audio_minutes: null,
      }),
    ).toEqual({ canConvert: true, missing: [] });
    expect(
      canConvert("pages_read", "percent_complete", {
        total_pages: null,
        total_audio_minutes: 10,
      }),
    ).toEqual({ canConvert: false, missing: ["total_pages"] });
    expect(
      canConvert("minutes_listened", "percent_complete", {
        total_pages: 10,
        total_audio_minutes: null,
      }),
    ).toEqual({ canConvert: false, missing: ["total_audio_minutes"] });
    expect(
      canConvert("percent_complete", "pages_read", {
        total_pages: 10,
        total_audio_minutes: null,
      }),
    ).toEqual({ canConvert: true, missing: [] });
  });
});
