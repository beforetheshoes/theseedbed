import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GLOBALS_CSS_PATH = resolve(process.cwd(), "src/app/globals.css");

function readGlobalsCss() {
  return readFileSync(GLOBALS_CSS_PATH, "utf8");
}

describe("globals.css layering contract", () => {
  it("declares the canonical layer order including primereact and app-overrides", () => {
    const css = readGlobalsCss();

    expect(css).toContain(
      "@layer theme, base, primereact, components, utilities, app-overrides;",
    );
  });

  it("keeps PrimeReact overrides inside the app-overrides layer", () => {
    const css = readGlobalsCss();
    const match = css.match(/@layer app-overrides\s*\{([\s\S]*)\}\s*$/);

    expect(match).not.toBeNull();

    const appOverrides = match?.[1] ?? "";

    expect(appOverrides).toContain(".p-component {");
    expect(appOverrides).toContain(".p-button {");
    expect(appOverrides).toContain(".p-inputtext {");
  });

  it("uses compact sizing (~40px) not Lara defaults (~50px)", () => {
    const css = readGlobalsCss();
    const match = css.match(/@layer app-overrides\s*\{([\s\S]*)\}\s*$/);
    const appOverrides = match?.[1] ?? "";

    // Verify font-size is 0.875rem (compact), not 1rem (Lara default)
    expect(appOverrides).toContain("font-size: 0.875rem;");
    expect(appOverrides).not.toMatch(/\.p-button\s*\{[^}]*font-size:\s*1rem/);
    expect(appOverrides).not.toMatch(
      /\.p-inputtext\s*\{[^}]*font-size:\s*1rem/,
    );
  });

  it("does not keep removed broad global PrimeReact selector overrides", () => {
    const css = readGlobalsCss();

    expect(css).not.toContain("\n.p-dropdown {\n");
  });
});
