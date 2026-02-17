export const PROTECTED_PREFIXES = ["/library", "/books", "/settings"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function loginRedirectPath(pathname: string, search: string): string {
  const fullPath = `${pathname}${search}`;
  return `/login?returnTo=${encodeURIComponent(fullPath)}`;
}

export function wantsActivityPub(acceptHeader: string): boolean {
  return acceptHeader.toLowerCase().includes("application/activity+json");
}
