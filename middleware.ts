import { auth } from "@/lib/auth";
import { canAccessDashboard } from "@/lib/roles";
import { NextResponse, type NextRequest } from "next/server";

const publicRoutes = ["/login", "/register", "/api/auth"];

export default async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Пропускаем публичные роуты и API auth
    if (publicRoutes.some(route => pathname.startsWith(route))) {
        return NextResponse.next();
    }

    const session = await auth.api.getSession({
        headers: request.headers
    });

    // Если нет сессии и пытаемся зайти на защищенный роут
    if (!session) {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    // Если есть сессия и пытаемся зайти на логин/регистрацию
    if (session && (pathname === "/login" || pathname === "/register")) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    // Проверка доступа к dashboard для роли CLIENT
    if (!canAccessDashboard(session.user.role)) {
        // В MVP клиент не имеет доступа к dashboard
        return NextResponse.redirect(new URL("/login", request.url));
    }

    return NextResponse.next();
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
        "/register"
    ]
};
