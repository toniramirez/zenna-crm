import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database.types";

// `/api/instagram/webhook` entra sin cookies: lo llama Meta, no un navegador.
// Si no estuviera acá, el proxy le devolvería un redirect a /login y Meta
// interpretaría el webhook como caído. Se autentica por firma HMAC, no por
// sesión (ver app/api/instagram/webhook/route.ts).
// Las tres páginas legales tienen que abrir sin sesión: Meta las carga desde su
// revisor para publicar la app, y si el proxy las mandara a /login vería un
// formulario de ingreso en vez del documento y rechazaría la solicitud.
// El service worker y el manifest los pide el navegador por su cuenta, a veces
// sin cookies (y en iOS, antes de instalar la app). Si el proxy los mandara a
// /login, el navegador guardaría ese HTML como si fuera el service worker y las
// notificaciones no se activarían nunca.
// `/api/push/subscribe` entra acá por el mismo motivo: el service worker lo
// llama cuando Apple o Google rotan la suscripción, y para entonces la sesión
// puede estar vencida. El handler valida por su cuenta (ver el route).
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/auth",
  "/api/instagram/webhook",
  "/api/push/subscribe",
  "/privacidad",
  "/terminos",
  "/eliminacion-de-datos",
  "/sw.js",
  "/manifest.webmanifest",
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: Don't put any logic between createServerClient and getUser().
  // Supabase docs warn this can cause sessions to be silently dropped.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
