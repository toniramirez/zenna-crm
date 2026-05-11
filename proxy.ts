import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const FINANZAS_PIN_COOKIE = "finanzas_pin_ok";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);

  if (!request.nextUrl.pathname.startsWith("/finanzas")) {
    response.cookies.set(FINANZAS_PIN_COOKIE, "", {
      path: "/finanzas",
      maxAge: 0,
    });
  }

  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
