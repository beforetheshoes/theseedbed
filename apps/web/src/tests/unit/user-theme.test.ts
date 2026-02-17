import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FONT_FAMILY_STACKS,
  applyUserTheme,
  getThemeWarnings,
  isThemeFontFamily,
  normalizeHexColor,
  reapplyThemeRecolor,
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

  it("uses heading font family when provided", () => {
    const result = applyUserTheme({
      theme_font_family: "inter",
      theme_heading_font_family: "lora",
    });
    expect(result).toEqual(
      expect.objectContaining({
        fontFamily: "inter",
        headingFontFamily: "lora",
      }),
    );
    expect(
      document.documentElement.style.getPropertyValue(
        "--app-heading-font-family",
      ),
    ).toBe(FONT_FAMILY_STACKS.lora);
  });

  it("falls back heading font to body font when heading font is invalid", () => {
    const result = applyUserTheme({
      theme_font_family: "inter",
      theme_heading_font_family: "invalid" as never,
    });
    expect(result?.headingFontFamily).toBe("inter");
  });
});

// ── PrimeReact theme recoloring ──────────────────────────────────────

describe("PrimeReact theme recoloring", () => {
  const fetchMock = vi.fn();
  // Use a unique URL counter to avoid cross-test cache hits from the
  // module-level cssTextCache Map inside user-theme.ts.
  let urlCounter = 0;

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    urlCounter += 1;
    // Remove any leftover elements from previous tests.
    document.getElementById("primereact-theme")?.remove();
    document.getElementById("primereact-theme-recolor")?.remove();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.getElementById("primereact-theme")?.remove();
    document.getElementById("primereact-theme-recolor")?.remove();
    document.documentElement.classList.remove("dark");
  });

  function addThemeLink() {
    const link = document.createElement("link");
    link.id = "primereact-theme";
    link.href = `https://cdn.example.com/theme-${urlCounter}.css`;
    document.head.appendChild(link);
    return link;
  }

  it("fetches theme CSS and injects recolored style element", async () => {
    addThemeLink();
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("body { color: #6366f1; }"),
    });

    applyUserTheme({ theme_primary_color: "#FF0000" });

    // Wait for the async injectRecoloredTheme to complete.
    await vi.waitFor(() => {
      const styleEl = document.getElementById("primereact-theme-recolor");
      expect(styleEl).not.toBeNull();
      // The default indigo #6366f1 should be replaced.
      expect(styleEl!.textContent).not.toContain("#6366f1");
    });
  });

  it("uses cached CSS on second call with same URL", async () => {
    addThemeLink();
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("body { color: #6366f1; }"),
    });

    applyUserTheme({ theme_primary_color: "#FF0000" });
    await vi.waitFor(() => {
      expect(
        document.getElementById("primereact-theme-recolor"),
      ).not.toBeNull();
    });

    // Second call with same link href should use the in-module cache.
    applyUserTheme({ theme_primary_color: "#00FF00" });
    await vi.waitFor(() => {
      const styleEl = document.getElementById("primereact-theme-recolor");
      expect(styleEl).not.toBeNull();
    });

    // fetch should only have been called once because of the cache.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("removes override style when default indigo color is used", async () => {
    addThemeLink();
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("body { color: #6366f1; }"),
    });

    // First apply a custom color to create the override.
    applyUserTheme({ theme_primary_color: "#FF0000" });
    await vi.waitFor(() => {
      expect(
        document.getElementById("primereact-theme-recolor"),
      ).not.toBeNull();
    });

    // Now apply default indigo, which should remove the override.
    applyUserTheme({ theme_primary_color: "#6366F1" });
    await vi.waitFor(() => {
      expect(document.getElementById("primereact-theme-recolor")).toBeNull();
    });
  });

  it("handles default indigo when no override style exists yet", async () => {
    addThemeLink();
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("body { color: #6366f1; }"),
    });

    // Apply default indigo directly without a prior custom theme.
    // No #primereact-theme-recolor element exists, so the "if (existing)" branch is false.
    applyUserTheme({ theme_primary_color: "#6366F1" });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.getElementById("primereact-theme-recolor")).toBeNull();
  });

  it("does nothing when no theme link element exists", async () => {
    // No #primereact-theme link in the DOM.
    applyUserTheme({ theme_primary_color: "#FF0000" });

    // Give async code time to run.
    await new Promise((r) => setTimeout(r, 50));
    expect(document.getElementById("primereact-theme-recolor")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles fetch failure gracefully", async () => {
    addThemeLink();
    fetchMock.mockRejectedValue(new Error("Network error"));

    applyUserTheme({ theme_primary_color: "#FF0000" });

    // Give async code time to run.
    await new Promise((r) => setTimeout(r, 50));
    expect(document.getElementById("primereact-theme-recolor")).toBeNull();
  });

  it("handles non-ok fetch response gracefully", async () => {
    addThemeLink();
    fetchMock.mockResolvedValue({
      ok: false,
      text: () => Promise.resolve(""),
    });

    applyUserTheme({ theme_primary_color: "#FF0000" });

    await new Promise((r) => setTimeout(r, 50));
    expect(document.getElementById("primereact-theme-recolor")).toBeNull();
  });

  it("applies dark mode replacements when dark class is present", async () => {
    addThemeLink();
    document.documentElement.classList.add("dark");
    // Include colors from DARK_THEME_REPLACEMENTS: #818cf8 -> 400, #a5b4fc -> 300
    fetchMock.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve("body { color: #818cf8; background: #a5b4fc; }"),
    });

    applyUserTheme({ theme_primary_color: "#FF0000" });

    await vi.waitFor(() => {
      const styleEl = document.getElementById("primereact-theme-recolor");
      expect(styleEl).not.toBeNull();
      expect(styleEl!.textContent).not.toContain("#818cf8");
      expect(styleEl!.textContent).not.toContain("#a5b4fc");
    });
  });

  it("reapplyThemeRecolor clears cache and re-fetches", async () => {
    addThemeLink();
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("body { color: #6366f1; }"),
    });

    // Apply a custom theme first to set lastAppliedPrimary.
    applyUserTheme({ theme_primary_color: "#FF0000" });
    await vi.waitFor(() => {
      expect(
        document.getElementById("primereact-theme-recolor"),
      ).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // reapplyThemeRecolor clears the cache, so even the same URL will re-fetch.
    reapplyThemeRecolor();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("reapplyThemeRecolor does nothing when no theme has been applied yet", () => {
    // We cannot truly reset the module-level lastAppliedPrimary without
    // re-importing. This test just verifies the function does not throw
    // and does not crash when there is no theme link element.
    expect(() => reapplyThemeRecolor()).not.toThrow();
  });
});
