import type { Metadata, Viewport } from "next";
import {
  Cormorant_Garamond,
  Inter,
  JetBrains_Mono,
  Sora,
} from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";
import "./globals.css";

/*
 * Las cuatro familias del referente (peluquerOS), con los mismos pesos y
 * estilos que sirve su bundle. Los nombres de las variables CSS también son
 * los suyos, así los stacks de app/globals.css quedan calcados:
 *
 *   --font-inter          → texto de la interfaz
 *   --font-sora           → títulos de pantalla (font-display)
 *   --font-cormorant      → serif editorial / wordmark (font-editorial)
 *   --font-jetbrains-mono → números tabulares, códigos, teclas
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Zenna CRM",
  description:
    "Sistema integral para peluquería: turnero, clientas, finanzas y CRM con WhatsApp.",
  applicationName: "Zenna",
  appleWebApp: {
    capable: true,
    title: "Zenna",
    // La app instalada arranca en la bandeja y la bandeja es oscura: con
    // "default" (barra blanca) la hora del teléfono queda ilegible.
    statusBarStyle: "black-translucent",
  },
};

/**
 * El teléfono va oscuro y el escritorio claro (ver `@media (width < 48rem)` en
 * app/globals.css), así que la barra del navegador se pinta por ancho. El
 * atributo `media` de `theme-color` acepta cualquier media query, no sólo
 * `prefers-color-scheme`.
 *
 * `viewportFit: "cover"` es lo que habilita `env(safe-area-inset-*)`: sin eso,
 * la barra de pestañas se apoyaría sobre el gesto de inicio del iPhone.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(max-width: 767px)", color: "#0b141a" },
    { media: "(min-width: 768px)", color: "#fbfaf9" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-AR"
      className={`${inter.variable} ${sora.variable} ${cormorant.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
        {/*
         * Abajo a la derecha: no tapa ningún encabezado. En el teléfono el
         * offset suma `--tabbar-space` para que el aviso quede arriba de la
         * barra de pestañas y no debajo (donde no se lee ni se cierra).
         */}
        <Toaster
          richColors
          closeButton
          position="bottom-right"
          mobileOffset={{
            bottom: "calc(1rem + var(--tabbar-space))",
            right: "0.75rem",
            left: "0.75rem",
          }}
        />
      </body>
    </html>
  );
}
