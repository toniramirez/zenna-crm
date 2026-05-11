# Zenna Worker (Baileys / WhatsApp)

Worker independiente que mantiene la conexión con WhatsApp Web vía
[Baileys](https://github.com/WhiskeySockets/Baileys) y sincroniza mensajes
con Supabase.

## Setup (1 sola vez)

1. Conseguí el **`SUPABASE_SERVICE_ROLE_KEY`** desde el dashboard de Supabase
   (Settings → API Keys → service_role). Es distinto al publishable.
   Pegalo en `.env.local`:

   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
   ```

2. Arrancá el worker:

   ```powershell
   npm run worker
   ```

3. La primera vez muestra un QR en la terminal. Abrí WhatsApp del salón →
   Dispositivos vinculados → Vincular dispositivo → escaneá. El auth queda
   guardado en Supabase (tabla `whatsapp_sessions`), así que las próximas
   veces se reconecta solo sin pedir QR.

## Cómo funciona

- **Entrantes**: cualquier mensaje que llegue al WhatsApp del salón se
  inserta en `public.messages` como `direction='inbound'`. Si la conversación
  no existe, se crea, y se intenta linkear automáticamente con una `client`
  matchando por teléfono (últimos 8 dígitos).
- **Salientes**: la UI inserta mensajes con `status='queued'`. El worker
  poll'ea cada 2s, los marca como `'sending'` (atómicamente, para evitar
  doble envío), los manda por Baileys, y los actualiza a `'sent'` con el
  `external_id` que devuelve WhatsApp.
- **Acks**: cuando WhatsApp notifica `delivered`/`read`, el worker actualiza
  el status del mensaje y los timestamps correspondientes.

## Producción en la PC del salón

Usá [pm2](https://pm2.keymetrics.io/) para que se reinicie solo:

```powershell
npm install -g pm2
pm2 start ecosystem.config.js
pm2 startup        # configura para que arranque con Windows
pm2 save
```

Ver `ecosystem.config.js` en la raíz del repo.

## Reset

Si el celular del salón cerró la sesión y querés volver a pairear:

```sql
delete from public.whatsapp_sessions where session_id = 'default';
```

Después corré `npm run worker` y va a mostrar QR de nuevo.
