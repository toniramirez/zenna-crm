"use client";

import { Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BrandWordmark } from "./brand-wordmark";
import type { NavItem } from "./nav";
import { SidebarNav } from "./sidebar-nav";

export function MobileSidebar({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="size-5" />
          <span className="sr-only">Abrir menú</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[260px] p-0">
        <SheetHeader className="border-b border-border/60 px-4 py-6 flex items-center">
          <SheetTitle className="sr-only">Zenna Hair Salon</SheetTitle>
          <SheetDescription className="sr-only">
            Menú de navegación
          </SheetDescription>
          <BrandWordmark size="md" />
        </SheetHeader>
        <div className="p-3">
          <SidebarNav items={items} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
