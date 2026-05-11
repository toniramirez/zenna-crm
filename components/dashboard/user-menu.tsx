"use client";

import { KeyRound, LogOut } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AppRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { ROLE_LABEL } from "./nav";

function initialsFromEmail(email: string) {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "??";
  return parts.map((p) => p[0]?.toUpperCase()).join("") || "??";
}

export function UserMenu({
  email,
  role,
  compact = false,
}: {
  email: string;
  role: AppRole;
  compact?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={compact ? email : undefined}
          title={compact ? email : undefined}
          className={cn(
            "h-auto w-full",
            compact
              ? "justify-center px-1 py-1.5"
              : "justify-start gap-3 px-2 py-2",
          )}
        >
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">
              {initialsFromEmail(email)}
            </AvatarFallback>
          </Avatar>
          {compact ? null : (
            <div className="flex flex-col items-start leading-tight overflow-hidden">
              <span className="text-sm font-medium truncate max-w-[160px]">
                {email}
              </span>
              <span className="text-xs text-muted-foreground">
                {ROLE_LABEL[role]}
              </span>
            </div>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="text-sm font-medium truncate">{email}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {ROLE_LABEL[role]}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/cambiar-contrasena">
            <KeyRound className="size-4" />
            Cambiar contraseña
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="text-destructive focus:text-destructive">
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-2 cursor-pointer"
            >
              <LogOut className="size-4" />
              Cerrar sesión
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
