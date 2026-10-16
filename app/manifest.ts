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
     * La Z de Zenna. En iPhone es también el ícono de cada notificación (iOS
     * no deja poner uno por aviso). El de iOS sale de app/apple-icon.png;
     * estos son para Android y la compu. El maskable lleva la Z más chica para
     * que entre en el círculo seguro cuando Android le recorta la forma.
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
        src: "/icons/app-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
