import type { Metadata } from "next";
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
    statusBarStyle: "default",
  },
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
         * Mobile-safe toast position: bottom-right never overlaps the mobile
         * header (h-14) at the top. mobileOffset adds breathing room on
         * narrow screens.
         */}
        <Toaster
          richColors
          closeButton
          position="bottom-right"
          mobileOffset={{ bottom: "1rem", right: "0.75rem", left: "0.75rem" }}
        />
      </body>
    </html>
  );
}
