"use client";

import { CreditCard, Megaphone, Sparkles, Tag, Wand2, Zap } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type { WhatsappTemplateRow } from "@/lib/whatsapp-cloud/templates";
import { AutomationsManager } from "./automations-manager";
import { BroadcastsManager } from "./broadcasts-manager";
import type {
  AutomationFlow,
  BroadcastWithStats,
  ClientTag,
  PaymentMethod,
  ProfessionalSlim,
  QuickReply,
  ServiceSlim,
} from "./config-types";
import { OutreachManager } from "./outreach-manager";
import type { OutreachSuggestionWithRelations } from "./outreach-types";
import { PaymentMethodsManager } from "./payment-methods-manager";
import { QuickRepliesManager } from "./quick-replies-manager";
import { TagsManager } from "./tags-manager";

/**
 * Configuration tab inside /crm. Sub-sections for managing the
 * CRM-side resources: tag taxonomy, quick-reply templates, automation
 * flows tied to services, broadcasts to filtered segments, and the payment
 * methods used for budgets.
 */
export function CrmConfig({
  tags,
  quickReplies,
  flows,
  waTemplates,
  services,
  paymentMethods,
  outreachSuggestions,
  broadcasts,
  professionals,
}: {
  tags: ClientTag[];
  quickReplies: QuickReply[];
  flows: AutomationFlow[];
  /** Plantillas aprobadas del WABA, para los flujos que mandan plantilla. */
  waTemplates: WhatsappTemplateRow[];
  services: ServiceSlim[];
  paymentMethods: PaymentMethod[];
  outreachSuggestions: OutreachSuggestionWithRelations[];
  broadcasts: BroadcastWithStats[];
  professionals: ProfessionalSlim[];
}) {
  const pendingOutreach = outreachSuggestions.filter(
    (s) => s.status === "pending",
  ).length;
  const liveBroadcasts = broadcasts.filter(
    (b) => b.status === "scheduled" || b.status === "sending",
  ).length;
  return (
    <Tabs defaultValue="tags" className="space-y-4">
      <TabsList>
        <TabsTrigger value="tags">
          <Tag className="size-3.5" />
          Etiquetas
          <span className="ml-1 inline-flex items-center justify-center rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
            {tags.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="replies">
          <Wand2 className="size-3.5" />
          Mensajes rápidos
          <span className="ml-1 inline-flex items-center justify-center rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
            {quickReplies.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="flows">
          <Zap className="size-3.5" />
          Automatizaciones
          <span className="ml-1 inline-flex items-center justify-center rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
            {flows.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="broadcasts">
          <Megaphone className="size-3.5" />
          Difusiones
          {liveBroadcasts > 0 ? (
            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-gold/20 text-gold px-1.5 text-[10px] tabular-nums">
              {liveBroadcasts}
            </span>
          ) : (
            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
              {broadcasts.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="payments">
          <CreditCard className="size-3.5" />
          Medios de pago
          <span className="ml-1 inline-flex items-center justify-center rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
            {paymentMethods.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="outreach">
          <Sparkles className="size-3.5" />
          Recomendaciones IA
          {pendingOutreach > 0 ? (
            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-gold/20 text-gold px-1.5 text-[10px] tabular-nums">
              {pendingOutreach}
            </span>
          ) : null}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="tags">
        <TagsManager tags={tags} />
      </TabsContent>
      <TabsContent value="replies">
        <QuickRepliesManager replies={quickReplies} />
      </TabsContent>
      <TabsContent value="flows">
        <AutomationsManager
          flows={flows}
          services={services}
          waTemplates={waTemplates}
        />
      </TabsContent>
      <TabsContent value="broadcasts">
        <BroadcastsManager
          broadcasts={broadcasts}
          tags={tags}
          services={services}
          professionals={professionals}
          waTemplates={waTemplates}
        />
      </TabsContent>
      <TabsContent value="payments">
        <PaymentMethodsManager methods={paymentMethods} />
      </TabsContent>
      <TabsContent value="outreach">
        <OutreachManager suggestions={outreachSuggestions} />
      </TabsContent>
    </Tabs>
  );
}
