"use client";

import { InstagramIcon } from "@/components/icons/instagram";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useSignedUrl } from "./use-signed-url";
import { WindowRing, windowRingGeometry } from "./window-timer";

function initials(name: string | null | undefined, fallback = "??") {
  const src = (name ?? "").trim();
  if (!src) return fallback;
  return (
    src
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || fallback
  );
}

export function ChatAvatar({
  name,
  avatarPath,
  channel,
  windowLeftMs,
  className,
  size = 40,
}: {
  name: string | null | undefined;
  avatarPath: string | null | undefined;
  /** Canal de la conversación. Solo se marca Instagram: WhatsApp es el default. */
  channel?: string | null;
  /**
   * Lo que le queda a la ventana de 24 h de la Cloud API, en ms (null o ≤0 =
   * cerrada). Abierta, el avatar lleva el anillo de la ventana alrededor.
   */
  windowLeftMs?: number | null;
  className?: string;
  size?: number;
}) {
  const url = useSignedUrl(avatarPath ?? null);
  const isInstagram = channel === "instagram";
  const windowOpen = windowLeftMs != null && windowLeftMs > 0;
  // Con anillo, el avatar se achica para dejarle lugar y un aire alrededor,
  // como un Estado de WhatsApp. La caja sigue midiendo `size`: el anillo se
  // asoma un pelo por fuera, así la fila no se mueve al abrirse la ventana.
  const inset = windowOpen ? windowRingGeometry(size).inset : 0;

  // El badge escala con el avatar para que se lea igual en la lista (48px)
  // que en el encabezado del chat (36px).
  const badgeSize = Math.max(14, Math.round(size * 0.36));

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      {windowLeftMs != null && windowLeftMs > 0 ? (
        <WindowRing leftMs={windowLeftMs} size={size} />
      ) : null}
      <Avatar className="absolute size-auto" style={{ inset }}>
        {url ? <AvatarImage src={url} alt={name ?? "Avatar"} /> : null}
        <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
      </Avatar>

      {isInstagram ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full bg-gradient-to-br from-fuchsia-600 to-orange-500 ring-2 ring-background"
          style={{ width: badgeSize, height: badgeSize }}
          title="Instagram"
        >
          <InstagramIcon
            className="text-white"
            style={{ width: badgeSize * 0.6, height: badgeSize * 0.6 }}
          />
        </span>
      ) : null}
    </div>
  );
}
