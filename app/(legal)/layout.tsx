import Link from "next/link";

/**
 * Páginas legales públicas.
 *
 * Existen porque Meta las exige para publicar la app de Instagram: pide una URL
 * de política de privacidad, una de condiciones y una de instrucciones de
 * eliminación de datos, todas accesibles **sin login**. Por eso viven fuera de
 * `(dashboard)` y están listadas en PUBLIC_PATHS de lib/supabase/middleware.ts —
 * si el proxy las mandara a /login, el revisor de Meta vería un formulario de
 * ingreso y rechazaría la app.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          {/* Texto y no link: `/` está detrás del login y mandar al revisor de
              Meta a un formulario de ingreso es motivo de rechazo. */}
          <span className="font-editorial text-xl">Zenna</span>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link href="/privacidad" className="hover:text-foreground">
              Privacidad
            </Link>
            <Link href="/terminos" className="hover:text-foreground">
              Términos
            </Link>
            <Link href="/eliminacion-de-datos" className="hover:text-foreground">
              Eliminar datos
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 [&_a]:underline [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mb-1.5 [&_p]:mb-4 [&_p]:leading-relaxed [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-3xl px-6 py-6 text-sm text-muted-foreground">
          Zenna — Sistema de gestión para peluquería.
        </div>
      </footer>
    </div>
  );
}
