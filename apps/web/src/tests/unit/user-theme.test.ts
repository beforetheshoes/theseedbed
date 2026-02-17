import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FONT_FAMILY_STACKS,
  applyUserTheme,
  getThemeWarnings,
  isThemeFontFamily,
  normalizeHexColor,
} from "@/lib/user-theme";

describe("user theme helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes valid hex values and rejects invalid ones", () => {
    expect(normalizeHexColor("#abcdef")).toBe("#ABCDEF");
    expect(normalizeHexColor(" #123456 ")).toBe("#123456");
    expect(normalizeHexColor("#12345")).toBeNull();
    expect(normalizeHexColor("blue")).toBeNull();
    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor(undefined)).toBeNull();
  });

  it("validates supported font families", () => {
    expect(isThemeFontFamily("ibm_plex_sans")).toBe(true);
    expect(isThemeFontFamily("atkinson")).toBe(true);
    expect(isThemeFontFamily("fraunces")).toBe(true);
    expect(isThemeFontFamily("serif")).toBe(false);
    expect(isThemeFontFamily(null)).toBe(false);
  });

  it("warns for low-contrast colors", () => {
    const warnings = getThemeWarnings({
      theme_primary_color: "#FFFFFF",
      theme_accent_color: "#000000",
    });
    expect(warnings.length).toBe(2);
    expect(warnings[0]?.field).toBe("theme_primary_color");
    expect(warnings[1]?.field).toBe("theme_accent_color");
  });

  it("returns warnings only for colors that fail contrast thresholds", () => {
    const warnings = getThemeWarnings({
      theme_primary_color: "#6366F1",
      theme_accent_color: "#14B8A6",
    });
    expect(warnings).toEqual([
      expect.objectContaining({ field: "theme_accent_color" }),
    ]);
  });

  it("applies normalized theme variables to the document root", () => {
    const result = applyUserTheme({
      theme_primary_color: "#abcdef",
      theme_accent_color: "#123456",
      theme_font_family: "fraunces",
    });

    expect(result).toEqual(
      expect.objectContaining({
        primary: "#ABCDEF",
        accent: "#123456",
        fontFamily: "fraunces",
      }),
    );
    expect(
      document.documentElement.style.getPropertyValue("--app-theme-primary"),
    ).toBe("#ABCDEF");
    expect(
      document.documentElement.style.getPropertyValue("--app-theme-accent"),
    ).toBe("#123456");
    expect(
      document.documentElement.style.getPropertyValue("--app-font-family"),
    ).toBe(FONT_FAMILY_STACKS.fraunces);
  });

  it("falls back to defaults for invalid values", () => {
    const result = applyUserTheme({
      theme_primary_color: "bad-color",
      theme_accent_color: null,
      theme_font_family: "not-valid" as never,
    });

    expect(result).toEqual(
      expect.objectContaining({
        primary: "#6366F1",
        accent: "#14B8A6",
        fontFamily: "ibm_plex_sans",
      }),
    );
    expect(
      document.documentElement.style.getPropertyValue("--app-theme-primary"),
    ).toBe("#6366F1");
    expect(
      document.documentElement.style.getPropertyValue("--app-theme-accent"),
    ).toBe("#14B8A6");
  });

  it("does nothing when document is unavailable", () => {
    vi.stubGlobal("document", undefined);
    const result = applyUserTheme({
      theme_primary_color: "#6366F1",
      theme_accent_color: "#14B8A6",
      theme_font_family: "ibm_plex_sans",
    });
    expect(result).toBeUndefined();
  });
});
