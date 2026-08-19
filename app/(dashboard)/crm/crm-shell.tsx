"use client";

import { ArrowLeft } from "lucide-react";
import { useState } from "react";
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
import type { WhatsappTemplateRow } from "@/lib/whatsapp-cloud/templates";
import type {
  AutomationFlow,
  ClientTag,
  PaymentMethod,
  QuickReply,
  ServiceSlim,
} from "./config-types";
import { CrmConfig } from "./crm-config";
import { CrmView } from "./crm-view";
import type { OutreachSuggestionWithRelations } from "./outreach-types";
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
  waTemplates,
  flows,
  services,
  bookingServices,
  professionals,
  clients,
  appointments,
  paymentMethods,
  outreachSuggestions,
}: {
  initialTab: "chat" | "config";
  conversations: ConversationWithClient[];
  initialSelectedId: string | null;
  tags: ClientTag[];
  quickReplies: QuickReply[];
  waTemplates: WhatsappTemplateRow[];
  flows: AutomationFlow[];
  services: ServiceSlim[];
  bookingServices: ServiceRow[];
  professionals: ProfessionalRow[];
  clients: Pick<ClientRow, "id" | "full_name" | "phone">[];
  appointments: AppointmentWithRelations[];
  paymentMethods: PaymentMethod[];
  outreachSuggestions: OutreachSuggestionWithRelations[];
}) {
  const [tab, setTab] = useState<"chat" | "config">(initialTab);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as "chat" | "config")}
      className="flex-1 min-h-0 gap-0"
    >
      {/*
        El referente no tiene barra de solapas: la bandeja ocupa la pantalla
        entera y la configuración se abre desde el "⋮" del panel izquierdo.
        Mantenemos <Tabs> porque conserva montado el chat (scroll y
        conversación seleccionada) al ir y volver de configuración.
      */}
      <TabsList className="sr-only">
        <TabsTrigger value="chat">Chat</TabsTrigger>
        <TabsTrigger value="config">Configuración</TabsTrigger>
      </TabsList>

      <TabsContent value="chat" className="m-0 flex-1 min-h-0">
        <CrmView
          initialConversations={conversations}
          initialSelectedId={initialSelectedId}
          quickReplies={quickReplies.filter((q) => q.active)}
          waTemplates={waTemplates}
          allTags={tags}
          bookingServices={bookingServices}
          professionals={professionals}
          clients={clients}
          appointments={appointments}
          paymentMethods={paymentMethods.filter((m) => m.active)}
          onOpenConfig={() => setTab("config")}
        />
      </TabsContent>

      <TabsContent
        value="config"
        className="m-0 flex-1 min-h-0 overflow-y-auto"
      >
        <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setTab("chat")}
            aria-label="Volver a la bandeja"
            title="Volver a la bandeja"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-[1.0625rem] font-medium">
            Configuración del CRM
          </h1>
          <span className="ml-auto text-[0.8125rem] text-muted-foreground tabular-nums">
            {conversations.length}{" "}
            {conversations.length === 1 ? "conversación" : "conversaciones"}
          </span>
        </div>
        <div className="p-4 sm:p-6">
          <CrmConfig
            tags={tags}
            quickReplies={quickReplies}
            flows={flows}
            services={services}
            paymentMethods={paymentMethods}
            outreachSuggestions={outreachSuggestions}
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}
