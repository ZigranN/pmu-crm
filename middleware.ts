import { NextRequest, NextResponse } from "next/server";

const publicPaths = [
  "/login",
  "/register",
];

function isPublicPath(pathname: string) {
  return (
    publicPaths.some((path) => pathname.startsWith(path)) ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  );
}

function hasBetterAuthSessionCookie(request: NextRequest) {
  const cookies = request.cookies.getAll();

  return cookies.some((cookie) => {
    const name = cookie.name.toLowerCase();
    return name.includes("better-auth") && name.includes("session");
  });
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/services") ||
    pathname.startsWith("/masters") ||
    pathname.startsWith("/clients") ||
    pathname.startsWith("/calendar") ||
    pathname.startsWith("/appointments") ||
    pathname.startsWith("/procedures") ||
    pathname.startsWith("/media") ||
    pathname.startsWith("/tasks") ||
    pathname.startsWith("/whatsapp") ||
    pathname.startsWith("/analytics");

  if (!isProtected) {
    return NextResponse.next();
  }

  if (!hasBetterAuthSessionCookie(request)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};