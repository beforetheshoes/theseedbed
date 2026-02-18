type RemoteProtocol = "http" | "https";

export type ImageRemotePattern = {
  protocol: RemoteProtocol;
  hostname: string;
  pathname: string;
  port?: string;
};

const KNOWN_SUPABASE_HOSTS = [
  "kypwcksvicrbrrwscdze.supabase.co",
  "aaohmjvcsgyqqlxomegu.supabase.co",
] as const;

function addPattern(
  patterns: ImageRemotePattern[],
  seen: Set<string>,
  pattern: ImageRemotePattern,
) {
  const key = `${pattern.protocol}|${pattern.hostname}|${pattern.port ?? "*"}|${pattern.pathname}`;
  if (seen.has(key)) return;
  seen.add(key);
  patterns.push(pattern);
}

function parseSupabaseUrl(rawUrl: string | undefined) {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

export function buildImageRemotePatterns(
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): ImageRemotePattern[] {
  const patterns: ImageRemotePattern[] = [];
  const seen = new Set<string>();

  addPattern(patterns, seen, {
    protocol: "https",
    hostname: "covers.openlibrary.org",
    pathname: "/b/**",
  });

  addPattern(patterns, seen, {
    protocol: "https",
    hostname: "books.google.com",
    pathname: "/books/content",
  });

  addPattern(patterns, seen, {
    protocol: "https",
    hostname: "books.google.com",
    pathname: "/books/content**",
  });

  addPattern(patterns, seen, {
    protocol: "https",
    hostname: "*.googleusercontent.com",
    pathname: "/**",
  });

  for (const hostname of KNOWN_SUPABASE_HOSTS) {
    addPattern(patterns, seen, {
      protocol: "https",
      hostname,
      pathname: "/storage/v1/object/public/**",
    });
  }

  addPattern(patterns, seen, {
    protocol: "http",
    hostname: "127.0.0.1",
    port: "54321",
    pathname: "/storage/v1/object/public/**",
  });
  addPattern(patterns, seen, {
    protocol: "http",
    hostname: "127.0.0.1",
    port: "55421",
    pathname: "/storage/v1/object/public/**",
  });
  addPattern(patterns, seen, {
    protocol: "http",
    hostname: "localhost",
    port: "54321",
    pathname: "/storage/v1/object/public/**",
  });
  addPattern(patterns, seen, {
    protocol: "http",
    hostname: "localhost",
    port: "55421",
    pathname: "/storage/v1/object/public/**",
  });

  const parsedSupabaseUrl = parseSupabaseUrl(supabaseUrl);
  if (parsedSupabaseUrl) {
    addPattern(patterns, seen, {
      protocol: parsedSupabaseUrl.protocol === "http:" ? "http" : "https",
      hostname: parsedSupabaseUrl.hostname,
      port: parsedSupabaseUrl.port || undefined,
      pathname: "/storage/v1/object/public/**",
    });
  }

  return patterns;
}
