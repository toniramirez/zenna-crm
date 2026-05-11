"use client";

import { CreditCard, Sparkles, Tag, Wand2, Zap } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { AutomationsManager } from "./automations-manager";
import type {
  AutomationFlow,
  ClientTag,
  PaymentMethod,
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
 * flows tied to services, and the payment methods used for budgets.
 */
export function CrmConfig({
  tags,
  quickReplies,
  flows,
  services,
  paymentMethods,
  outreachSuggestions,
}: {
  tags: ClientTag[];
  quickReplies: QuickReply[];
  flows: AutomationFlow[];
  services: ServiceSlim[];
  paymentMethods: PaymentMethod[];
  outreachSuggestions: OutreachSuggestionWithRelations[];
}) {
  const pendingOutreach = outreachSuggestions.filter(
    (s) => s.status === "pending",
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
        <AutomationsManager flows={flows} services={services} />
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
