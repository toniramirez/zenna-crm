import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Fraunces is a high-contrast variable serif that matches the Zenna wordmark.
// Used for the brand wordmark and a few decorative headings — NOT for body or
// every h1, to avoid that "wedding invitation" look that dates a SaaS UI fast.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Zenna CRM",
  description:
    "Sistema integral para peluquería: turnero, clientas, finanzas y CRM con WhatsApp.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-AR"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
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
