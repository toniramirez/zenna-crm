"use client";

import { Zap } from "lucide-react";
import { InstagramIcon } from "@/components/icons/instagram";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useSignedUrl } from "./use-signed-url";

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
  className,
  size = 40,
}: {
  name: string | null | undefined;
  avatarPath: string | null | undefined;
  /** Canal de la conversación. Solo se marca Instagram: WhatsApp es el default. */
  channel?: string | null;
  className?: string;
  size?: number;
}) {
  const url = useSignedUrl(avatarPath ?? null);
  const isInstagram = channel === "instagram";
  const isCloudApi = channel === "whatsapp_cloud";

  // El badge escala con el avatar para que se lea igual en la lista (48px)
  // que en el encabezado del chat (36px).
  const badgeSize = Math.max(14, Math.round(size * 0.36));

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <Avatar className="size-full">
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

      {/* El canal oficial se distingue del WhatsApp del QR (que va sin
          badge): mismo lugar que el de Instagram, en verde y con un rayo. */}
      {isCloudApi ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 ring-2 ring-background"
          style={{ width: badgeSize, height: badgeSize }}
          title="WhatsApp API"
        >
          <Zap
            className="text-white"
            style={{ width: badgeSize * 0.6, height: badgeSize * 0.6 }}
          />
        </span>
      ) : null}
    </div>
  );
}
