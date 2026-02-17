export type ColorMode = "light" | "dark" | "system";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function getInitialColorMode(
  cookie: string,
  cookieName: string,
): ColorMode {
  const matched = cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${cookieName}=`));

  const value = matched
    ? decodeURIComponent(matched.split("=").slice(1).join("="))
    : "system";
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

export function writeColorModeCookie(
  cookieName: string,
  value: ColorMode,
  secure: boolean,
) {
  const parts = [
    `${cookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];

  if (secure) {
    parts.push("Secure");
  }

  document.cookie = parts.join("; ");
}
