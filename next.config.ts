import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    /*
     * Caché de router del lado del cliente.
     *
     * Todas las pantallas del dashboard son `force-dynamic`, y para una ruta
     * dinámica el default de `dynamic` es 0: nada se guarda. Con la barra de
     * pestañas del teléfono eso significaba que ir a Turnos, mirar, y volver
     * a Chats era un viaje entero al servidor —sesión, perfil y las consultas
     * de la pantalla— para redibujar algo que se había visto hace cuatro
     * segundos. Es el "ida y vuelta" que más se nota, porque es el gesto que
     * más se repite.
     *
     * 30 segundos de reuso no dejan ver nada viejo en la práctica: las
     * acciones del servidor llaman `revalidatePath` y eso limpia esta caché,
     * y lo que cambia por fuera de la app —un WhatsApp que entra— lo trae el
     * realtime del cliente en cuanto la pantalla se monta.
     */
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
  },
  async headers() {
    return [
      {
        // El service worker no se puede cachear: si el navegador sirve una
        // copia vieja, los cambios en el manejo de las notificaciones no
        // llegan nunca al teléfono.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
