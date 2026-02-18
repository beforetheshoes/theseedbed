import { buildImageRemotePatterns } from "@/lib/image-remote-patterns";

function hostMatches(hostname: string, patternHost: string): boolean {
  if (!patternHost.startsWith("*.")) {
    return hostname === patternHost;
  }
  const suffix = patternHost.slice(1);
  return hostname.endsWith(suffix) && hostname.length > suffix.length;
}

function pathnameMatches(pathname: string, patternPathname: string): boolean {
  if (patternPathname.endsWith("/**")) {
    const prefix = patternPathname.slice(0, -3);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }
  if (patternPathname.endsWith("**")) {
    const prefix = patternPathname.slice(0, -2);
    return pathname.startsWith(prefix);
  }
  return pathname === patternPathname;
}

function portMatches(
  urlPort: string,
  patternPort: string | undefined,
): boolean {
  if (!patternPort) return true;
  return urlPort === patternPort;
}

export function isConfiguredRemoteImageUrl(src: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const protocol = parsed.protocol.slice(0, -1);
  const patterns = buildImageRemotePatterns();

  return patterns.some((pattern) => {
    if (pattern.protocol !== protocol) return false;
    if (!hostMatches(parsed.hostname, pattern.hostname)) return false;
    if (!portMatches(parsed.port, pattern.port)) return false;
    return pathnameMatches(parsed.pathname, pattern.pathname);
  });
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function shouldUseUnoptimizedForUrl(src: string): boolean {
  try {
    const parsed = new URL(src);
    if (isLocalHost(parsed.hostname)) return true;
  } catch {
    return true;
  }

  // Unknown hosts can still appear in legacy data; avoid runtime hostname errors.
  return !isConfiguredRemoteImageUrl(src);
}
