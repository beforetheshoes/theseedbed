export type ThemeFontFamily =
  | "atkinson"
  | "ibm_plex_sans"
  | "fraunces"
  | "inter"
  | "averia_libre"
  | "dongle"
  | "nunito_sans"
  | "lora"
  | "libre_baskerville";

export type UserThemeSettings = {
  theme_primary_color?: string | null;
  theme_accent_color?: string | null;
  theme_font_family?: ThemeFontFamily | null;
  theme_heading_font_family?: ThemeFontFamily | null;
};

export type ThemeWarning = {
  field: "theme_primary_color" | "theme_accent_color";
  message: string;
};

const USER_THEME_STORAGE_KEY = "seedbed.userTheme";

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const LIGHT_SURFACE = "#FFFFFF";
const DARK_SURFACE = "#0F172A";
const DEFAULT_PRIMARY_COLOR = "#6366F1";
const DEFAULT_ACCENT_COLOR = "#14B8A6";
const DEFAULT_FONT_FAMILY: ThemeFontFamily = "ibm_plex_sans";
const MIN_SURFACE_CONTRAST = 3;

export const FONT_FAMILY_STACKS: Record<ThemeFontFamily, string> = {
  atkinson: "'Atkinson Hyperlegible', ui-sans-serif, system-ui, sans-serif",
  ibm_plex_sans: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
  fraunces: "'Fraunces', ui-serif, Georgia, serif",
  inter: "'Inter', ui-sans-serif, system-ui, sans-serif",
  averia_libre: "'Averia Libre', ui-sans-serif, system-ui, sans-serif",
  dongle: "'Dongle', ui-sans-serif, system-ui, sans-serif",
  nunito_sans: "'Nunito Sans', ui-sans-serif, system-ui, sans-serif",
  lora: "'Lora', ui-serif, Georgia, serif",
  libre_baskerville: "'Libre Baskerville', ui-serif, Georgia, serif",
};

export const FONT_LABELS: Record<ThemeFontFamily, string> = {
  atkinson: "Atkinson Hyperlegible",
  ibm_plex_sans: "IBM Plex Sans",
  fraunces: "Fraunces",
  inter: "Inter",
  averia_libre: "Averia Libre",
  dongle: "Dongle",
  nunito_sans: "Nunito Sans",
  lora: "Lora",
  libre_baskerville: "Libre Baskerville",
};

type Rgb = { r: number; g: number; b: number };

const clamp = (value: number) => Math.max(0, Math.min(255, value));

const toRgb = (hex: string): Rgb => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
});

const toHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b]
    .map((part) => clamp(Math.round(part)).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();

const mix = (base: Rgb, target: Rgb, amount: number): Rgb => ({
  r: base.r + (target.r - base.r) * amount,
  g: base.g + (target.g - base.g) * amount,
  b: base.b + (target.b - base.b) * amount,
});

const toLinear = (channel: number): number => {
  const normalized = channel / 255;
  if (normalized <= 0.03928) return normalized / 12.92;
  return ((normalized + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const rgb = toRgb(hex);
  return (
    0.2126 * toLinear(rgb.r) +
    0.7152 * toLinear(rgb.g) +
    0.0722 * toLinear(rgb.b)
  );
};

const contrastRatio = (a: string, b: string): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

const bestTextColor = (background: string): string =>
  contrastRatio(background, "#FFFFFF") >= contrastRatio(background, "#111827")
    ? "#FFFFFF"
    : "#111827";

const buildPalette = (hex: string): Record<string, string> => {
  const base = toRgb(hex);
  const white = toRgb("#FFFFFF");
  const black = toRgb("#000000");
  return {
    "50": toHex(mix(base, white, 0.9)),
    "100": toHex(mix(base, white, 0.78)),
    "200": toHex(mix(base, white, 0.62)),
    "300": toHex(mix(base, white, 0.46)),
    "400": toHex(mix(base, white, 0.24)),
    "500": toHex(base),
    "600": toHex(mix(base, black, 0.12)),
    "700": toHex(mix(base, black, 0.24)),
    "800": toHex(mix(base, black, 0.36)),
    "900": toHex(mix(base, black, 0.5)),
    "950": toHex(mix(base, black, 0.64)),
  };
};

const findSafeColorForSurface = (
  baseHex: string,
  surfaceHex: string,
  minContrast: number,
  strategy: "lighten" | "darken",
): string => {
  if (contrastRatio(baseHex, surfaceHex) >= minContrast) return baseHex;
  const rgb = toRgb(baseHex);
  const target = strategy === "lighten" ? toRgb("#FFFFFF") : toRgb("#000000");
  for (let i = 1; i <= 24; i += 1) {
    const candidate = toHex(mix(rgb, target, i / 24));
    if (contrastRatio(candidate, surfaceHex) >= minContrast) return candidate;
  }
  /* v8 ignore next -- @preserve safety fallback; loop always finds a match at minContrast 3 */
  return baseHex;
};

export const normalizeHexColor = (
  value: string | null | undefined,
): string | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!HEX_COLOR_REGEX.test(trimmed)) return null;
  return trimmed.toUpperCase();
};

export const isThemeFontFamily = (
  value: string | null | undefined,
): value is ThemeFontFamily => value != null && value in FONT_FAMILY_STACKS;

export const getThemeWarnings = (
  settings: UserThemeSettings,
): ThemeWarning[] => {
  const warnings: ThemeWarning[] = [];
  const pairs: Array<{ field: ThemeWarning["field"]; value: string | null }> = [
    {
      field: "theme_primary_color",
      value: normalizeHexColor(settings.theme_primary_color),
    },
    {
      field: "theme_accent_color",
      value: normalizeHexColor(settings.theme_accent_color),
    },
  ];

  for (const pair of pairs) {
    if (!pair.value) continue;
    const lightContrast = contrastRatio(pair.value, LIGHT_SURFACE);
    const darkContrast = contrastRatio(pair.value, DARK_SURFACE);
    if (
      lightContrast < MIN_SURFACE_CONTRAST ||
      darkContrast < MIN_SURFACE_CONTRAST
    ) {
      const mode = lightContrast < MIN_SURFACE_CONTRAST ? "light" : "dark";
      warnings.push({
        field: pair.field,
        message: `${pair.field === "theme_primary_color" ? "Primary" : "Accent"} color may blend in for some users in ${mode} mode. Readability fallbacks will still be applied.`,
      });
    }
  }

  return warnings;
};

// ── Runtime theme CSS recoloring ──────────────────────────────────────────
// PrimeReact 10 Lara theme uses hardcoded hex colors, not CSS variables.
// We fetch the theme CSS text, replace the default indigo palette with the
// user's palette, and inject a <style> element to override.

// Default Lara indigo palette shades used in the theme CSS files.
const LIGHT_THEME_REPLACEMENTS: Array<[string, string]> = [
  // [default hex (lowercase), palette shade key]
  ["#eef2ff", "50"],
  ["#c7d2fe", "200"],
  ["#6366f1", "500"],
  ["#4f46e5", "600"],
  ["#4338ca", "700"],
];

const DARK_THEME_REPLACEMENTS: Array<[string, string]> = [
  ["#c7d2fe", "200"],
  ["#a5b4fc", "300"],
  ["#818cf8", "400"],
  ["#6366f1", "500"],
];

const RECOLOR_STYLE_ID = "primereact-theme-recolor";

// Cache fetched CSS text by URL to avoid re-fetching.
const cssTextCache = new Map<string, string>();

async function fetchThemeCss(url: string): Promise<string | null> {
  const cached = cssTextCache.get(url);
  if (cached) return cached;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const text = await response.text();
    cssTextCache.set(url, text);
    return text;
  } catch {
    return null;
  }
}

function recolorCss(
  cssText: string,
  palette: Record<string, string>,
  isDark: boolean,
): string {
  const replacements = isDark
    ? DARK_THEME_REPLACEMENTS
    : LIGHT_THEME_REPLACEMENTS;
  let result = cssText;
  for (const [defaultHex, shade] of replacements) {
    const userHex = palette[shade];
    /* v8 ignore next -- @preserve defensive guard; buildPalette always produces all shades */
    if (!userHex) continue;
    // Case-insensitive global replacement of the hex color.
    result = result.replaceAll(
      new RegExp(defaultHex.replace("#", "\\#"), "gi"),
      userHex.toLowerCase(),
    );
  }
  return result;
}

// Store last applied settings so dark/light mode switch can re-apply.
let lastAppliedPrimary: string | null = null;

async function injectRecoloredTheme(primary: string): Promise<void> {
  const link = document.getElementById(
    "primereact-theme",
  ) as HTMLLinkElement | null;
  if (!link?.href) return;

  const isDark = document.documentElement.classList.contains("dark");
  const cssText = await fetchThemeCss(link.href);
  if (!cssText) return;

  // If user chose the default indigo, remove the override to use the original.
  if (primary.toUpperCase() === DEFAULT_PRIMARY_COLOR) {
    const existing = document.getElementById(RECOLOR_STYLE_ID);
    if (existing) existing.remove();
    return;
  }

  const palette = buildPalette(primary);
  const recolored = recolorCss(cssText, palette, isDark);

  let styleEl = document.getElementById(
    RECOLOR_STYLE_ID,
  ) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = RECOLOR_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = recolored;
}

/**
 * Re-apply the primary color recoloring after a dark/light mode switch.
 * Called from use-color-mode.ts after the theme <link> href changes.
 */
export function reapplyThemeRecolor(): void {
  if (lastAppliedPrimary) {
    // Clear the CSS cache for the new theme URL and re-inject.
    cssTextCache.clear();
    void injectRecoloredTheme(lastAppliedPrimary);
  }
}

export const applyUserTheme = (settings: UserThemeSettings) => {
  if (!globalThis.document?.documentElement) return;
  const root = globalThis.document.documentElement;

  const primary =
    normalizeHexColor(settings.theme_primary_color) ?? DEFAULT_PRIMARY_COLOR;
  const accent =
    normalizeHexColor(settings.theme_accent_color) ?? DEFAULT_ACCENT_COLOR;
  const fontFamily = isThemeFontFamily(settings.theme_font_family)
    ? settings.theme_font_family
    : DEFAULT_FONT_FAMILY;
  const headingFontFamily = isThemeFontFamily(
    settings.theme_heading_font_family,
  )
    ? settings.theme_heading_font_family
    : fontFamily;

  const primarySafeLight = findSafeColorForSurface(
    primary,
    LIGHT_SURFACE,
    MIN_SURFACE_CONTRAST,
    "darken",
  );
  const primarySafeDark = findSafeColorForSurface(
    primary,
    DARK_SURFACE,
    MIN_SURFACE_CONTRAST,
    "lighten",
  );
  const accentSafeLight = findSafeColorForSurface(
    accent,
    LIGHT_SURFACE,
    MIN_SURFACE_CONTRAST,
    "darken",
  );
  const accentSafeDark = findSafeColorForSurface(
    accent,
    DARK_SURFACE,
    MIN_SURFACE_CONTRAST,
    "lighten",
  );

  root.style.setProperty("--app-theme-primary", primary);
  root.style.setProperty("--app-theme-primary-safe-light", primarySafeLight);
  root.style.setProperty("--app-theme-primary-safe-dark", primarySafeDark);
  root.style.setProperty(
    "--app-theme-primary-contrast",
    bestTextColor(primary),
  );
  root.style.setProperty("--app-theme-accent", accent);
  root.style.setProperty("--app-theme-accent-safe-light", accentSafeLight);
  root.style.setProperty("--app-theme-accent-safe-dark", accentSafeDark);
  root.style.setProperty("--app-theme-accent-contrast", bestTextColor(accent));
  root.style.setProperty("--app-font-family", FONT_FAMILY_STACKS[fontFamily]);
  root.style.setProperty(
    "--app-heading-font-family",
    FONT_FAMILY_STACKS[headingFontFamily],
  );

  // Build primary palette and set CSS variables.
  const palette = buildPalette(primary);
  for (const [shade, value] of Object.entries(palette)) {
    root.style.setProperty(`--p-primary-${shade}`, value);
  }

  root.style.setProperty("--primary-color", primary);
  root.style.setProperty("--primary-color-text", bestTextColor(primary));
  root.style.setProperty("--focus-ring", `0 0 0 0.2rem ${primary}40`);
  root.style.setProperty("--p-primary-color", primary);
  root.style.setProperty("--p-primary-contrast-color", bestTextColor(primary));
  root.style.setProperty("--p-highlight-background", accentSafeLight);
  root.style.setProperty("--p-highlight-color", bestTextColor(accentSafeLight));
  root.style.setProperty("--p-content-border-color", "var(--surface-d)");
  root.style.setProperty("--p-text-muted-color", "var(--text-color-secondary)");
  root.style.setProperty("--highlight-bg", accentSafeLight);
  root.style.setProperty(
    "--highlight-text-color",
    bestTextColor(accentSafeLight),
  );

  // Recolor the PrimeReact theme CSS with the user's primary palette.
  lastAppliedPrimary = primary;
  void injectRecoloredTheme(primary);

  try {
    globalThis.localStorage?.setItem(
      USER_THEME_STORAGE_KEY,
      JSON.stringify({
        theme_primary_color: primary,
        theme_accent_color: accent,
        theme_font_family: fontFamily,
        theme_heading_font_family: headingFontFamily,
      } satisfies UserThemeSettings),
    );
  } catch {
    // Ignore storage failures and keep runtime theme application.
  }

  return {
    primary,
    accent,
    fontFamily,
    headingFontFamily,
    warnings: getThemeWarnings(settings),
  };
};

export function readStoredUserTheme(): UserThemeSettings | null {
  try {
    const raw = globalThis.localStorage?.getItem(USER_THEME_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserThemeSettings;
  } catch {
    return null;
  }
}
