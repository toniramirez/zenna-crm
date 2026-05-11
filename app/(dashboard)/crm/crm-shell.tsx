"use client";

import { Maximize2, MessageSquare, Minimize2, Settings2 } from "lucide-react";
import { useFocusMode } from "@/components/dashboard/focus-mode-context";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type {
  AppointmentWithRelations,
  ClientRow,
  ProfessionalRow,
  ServiceRow,
} from "../turnos/types";
import type {
  AutomationFlow,
  ClientTag,
  PaymentMethod,
  QuickReply,
  ServiceSlim,
} from "./config-types";
import { CrmConfig } from "./crm-config";
import { CrmView } from "./crm-view";
import type { ConversationWithClient } from "./types";

/**
 * Two top-level tabs at /crm: the live chat workspace and the CRM
 * configuration (tags, quick replies, automations).
 *
 * shadcn Tabs keep both children mounted, so switching tabs doesn't reset
 * the chat scroll position or selected conversation.
 */
export function CrmShell({
  initialTab,
  conversations,
  initialSelectedId,
  tags,
  quickReplies,
  flows,
  services,
  bookingServices,
  professionals,
  clients,
  appointments,
  paymentMethods,
}: {
  initialTab: "chat" | "config";
  conversations: ConversationWithClient[];
  initialSelectedId: string | null;
  tags: ClientTag[];
  quickReplies: QuickReply[];
  flows: AutomationFlow[];
  services: ServiceSlim[];
  bookingServices: ServiceRow[];
  professionals: ProfessionalRow[];
  clients: Pick<ClientRow, "id" | "full_name" | "phone">[];
  appointments: AppointmentWithRelations[];
  paymentMethods: PaymentMethod[];
}) {
  const { focused, toggle } = useFocusMode();

  return (
    <Tabs defaultValue={initialTab} className="flex-1 min-h-0">
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold tracking-tight shrink-0">
            CRM
          </h1>
          <TabsList>
          <TabsTrigger value="chat">
            <MessageSquare className="size-3.5" />
            Chat
            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
              {conversations.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="config">
            <Settings2 className="size-3.5" />
            Configuración
          </TabsTrigger>
          </TabsList>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={toggle}
          className="h-8 px-2 text-xs gap-1.5"
          aria-pressed={focused}
          title={focused ? "Salir del modo foco" : "Modo foco"}
        >
          {focused ? (
            <Minimize2 className="size-3.5" />
          ) : (
            <Maximize2 className="size-3.5" />
          )}
          <span className="hidden sm:inline">
            {focused ? "Salir de foco" : "Foco"}
          </span>
        </Button>
      </div>

      <TabsContent value="chat" className="m-0 flex-1 min-h-0">
        <CrmView
          initialConversations={conversations}
          initialSelectedId={initialSelectedId}
          quickReplies={quickReplies.filter((q) => q.active)}
          allTags={tags}
          bookingServices={bookingServices}
          professionals={professionals}
          clients={clients}
          appointments={appointments}
          paymentMethods={paymentMethods.filter((m) => m.active)}
        />
      </TabsContent>

      <TabsContent value="config" className="m-0 flex-1 min-h-0 overflow-y-auto">
        <CrmConfig
          tags={tags}
          quickReplies={quickReplies}
          flows={flows}
          services={services}
          paymentMethods={paymentMethods}
        />
      </TabsContent>
    </Tabs>
  );
}
