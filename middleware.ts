import { auth } from "@/lib/auth";
import { canAccessDashboard } from "@/lib/roles";
import { NextResponse, type NextRequest } from "next/server";

const publicRoutes = ["/login", "/register", "/api/auth"];

export default async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (publicRoutes.some(route => pathname.startsWith(route))) {
        return NextResponse.next();
    }

    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session) {
            return NextResponse.redirect(
                new URL("/login", request.url)
            );
        }

        if (
            pathname !== "/login" &&
            pathname !== "/register" &&
            !canAccessDashboard(session.user.role)
        ) {
            return NextResponse.redirect(
                new URL("/login", request.url)
            );
        }

        return NextResponse.next();
    } catch (error) {
        console.error("Middleware session error:", error);

        return NextResponse.redirect(
            new URL("/login", request.url)
        );
    }
}

export const config = {
    matcher: [
        "/dashboard/:path*",
        "/settings/:path*",
        "/calendar/:path*",
        "/clients/:path*",
        "/appointments/:path*",
        "/services/:path*",
        "/masters/:path*",
        "/procedures/:path*",
        "/media/:path*",
        "/tasks/:path*",
        "/whatsapp/:path*",
        "/analytics/:path*",
        "/login",
        "/register",
    ],
};