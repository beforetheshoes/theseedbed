import { describe, expect, it } from "vitest";
import { getInitialColorMode, writeColorModeCookie } from "@/lib/color-mode";

describe("color mode cookie parsing", () => {
  it("returns system by default", () => {
    expect(getInitialColorMode("", "colorMode")).toBe("system");
  });

  it("reads valid cookie values", () => {
    expect(getInitialColorMode("foo=bar; colorMode=dark", "colorMode")).toBe(
      "dark",
    );
    expect(getInitialColorMode("colorMode=light", "colorMode")).toBe("light");
    expect(getInitialColorMode("colorMode=system", "colorMode")).toBe("system");
  });

  it("falls back to system for invalid values", () => {
    expect(getInitialColorMode("colorMode=unknown", "colorMode")).toBe(
      "system",
    );
  });

  it("writes a cookie without secure on http", () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      writable: true,
      value: "",
    });

    writeColorModeCookie("colorMode", "dark", false);
    expect(document.cookie).toContain("colorMode=dark");
    expect(document.cookie).toContain("Path=/");
    expect(document.cookie).toContain("SameSite=Lax");
    expect(document.cookie).toContain("Max-Age=");
    expect(document.cookie).not.toContain("Secure");
  });

  it("writes a secure cookie on https", () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      writable: true,
      value: "",
    });

    writeColorModeCookie("colorMode", "light", true);
    expect(document.cookie).toContain("colorMode=light");
    expect(document.cookie).toContain("Secure");
  });
});
