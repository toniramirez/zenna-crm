"use client";

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
  className,
  size = 40,
}: {
  name: string | null | undefined;
  avatarPath: string | null | undefined;
  className?: string;
  size?: number;
}) {
  const url = useSignedUrl(avatarPath ?? null);
  return (
    <Avatar
      className={cn("shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {url ? <AvatarImage src={url} alt={name ?? "Avatar"} /> : null}
      <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
