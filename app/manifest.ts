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
    icons: [
      {
        src: "/zenna-logo.png",
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
  };
}
