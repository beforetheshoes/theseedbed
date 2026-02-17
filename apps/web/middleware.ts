import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  isProtectedPath,
  loginRedirectPath,
  wantsActivityPub,
} from "@/lib/auth-routes";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isDev = process.env.NODE_ENV !== "production";

  if (pathname.startsWith("/u/")) {
    const accept = request.headers.get("accept") ?? "";
    if (accept && wantsActivityPub(accept)) {
      return NextResponse.json(
        {
          message: "ActivityPub is not implemented yet.",
        },
        { status: 406, statusText: "Not Acceptable" },
      );
    }
  }

  const { response, user } = await updateSession(request);
  const hasSession = Boolean(user);

  if (pathname === "/login" && hasSession) {
    return NextResponse.redirect(new URL("/library", request.url));
  }

  if (isProtectedPath(pathname) && !hasSession && !isDev) {
    return NextResponse.redirect(
      new URL(loginRedirectPath(pathname, search), request.url),
    );
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
