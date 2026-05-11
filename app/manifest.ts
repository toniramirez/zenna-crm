import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zenna CRM",
    short_name: "Zenna",
    description:
      "Sistema integral para peluquería: turnero, clientas, finanzas y CRM con WhatsApp.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f1eb",
    theme_color: "#f5f1eb",
    icons: [
      {
        src: "/zenna-logo.png",
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
  };
}
