// PM2 ecosystem — corre Next.js (web) + worker Baileys juntos en la PC del salón.
//
// Uso:
//   pm2 start ecosystem.config.js
//   pm2 startup    (una sola vez, para que se levante con Windows)
//   pm2 save
//
// Comandos útiles:
//   pm2 status                  → ver estado
//   pm2 logs zenna-worker       → logs del worker (QR, mensajes, errores)
//   pm2 logs zenna-web          → logs de Next.js
//   pm2 restart zenna-worker    → reiniciar solo el worker
//   pm2 stop all                → parar todo

module.exports = {
  apps: [
    {
      name: "zenna-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: "500M",
      env: { NODE_ENV: "production" },
    },
    {
      // Número VIEJO (Baileys). Desde la migración es archivo + redirección:
      // guarda lo que entra y contesta el aviso del número nuevo. No dispara
      // automatizaciones — ese reloj vive en zenna-wpp-api.
      name: "zenna-worker",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "worker/baileys.ts",
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: "400M",
      // The worker may exit on permanent disconnect; pm2 brings it back.
      restart_delay: 5000,
      env: { NODE_ENV: "production" },
    },
    {
      // Cola de salida de Instagram. Proceso aparte del de Baileys a propósito:
      // no comparten estado y un WhatsApp caído no tiene por qué frenar los DMs.
      // Los mensajes ENTRANTES no pasan por acá — llegan al webhook de Next.
      name: "zenna-instagram",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "worker/instagram.ts",
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: "300M",
      restart_delay: 5000,
      env: { NODE_ENV: "production" },
    },
    {
      // Número NUEVO: cola de salida de la WhatsApp Cloud API, el canal
      // principal. Mismo esquema que el de Instagram —solo HTTPS salientes; los
      // entrantes y los acuses llegan al webhook de Next— más el reloj de las
      // automatizaciones, que corre acá porque acá salen todas.
      name: "zenna-wpp-api",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "worker/whatsapp-cloud.ts",
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: "300M",
      restart_delay: 5000,
      env: { NODE_ENV: "production" },
    },
  ],
};
