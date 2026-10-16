import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zenna CRM",
    short_name: "Zenna",
    description:
      "Sistema integral para peluquería: turnero, clientas, finanzas y CRM con WhatsApp.",
    start_url: "/",
    display: "standalone",
    /*
     * La app se instala en el teléfono, y en el teléfono Zenna es oscura (ver
     * `@media (width < 48rem)` en app/globals.css). Con el crema de antes, la
     * pantalla de arranque y la barra de estado prendían en blanco y después
     * saltaban a negro.
     */
    background_color: "#0b141a",
    theme_color: "#0b141a",
    /*
     * El ícono de la app instalada es el de WhatsApp y no el logo de Zenna: en
     * iPhone es también el ícono de cada notificación (iOS no deja poner uno
     * por aviso), y el aviso tiene que verse como un mensaje de WhatsApp. El
     * de iOS sale de app/apple-icon.png; estos son para Android.
     */
    icons: [
      {
        src: "/icons/app-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/app-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/app-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
