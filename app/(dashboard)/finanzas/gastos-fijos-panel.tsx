"use client";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { PagosMesPanel } from "./pagos-mes-panel";
import { NewTemplateButton } from "./template-dialog";
import { TemplatesList } from "./templates-list";
import type { ExpenseRow, ExpenseTemplateRow } from "./types";

/**
 * Wrapper that holds the inner tabs for the "Gastos fijos" section:
 *   - Pagos del mes  (bill cards driven by templates)
 *   - Catálogo       (CRUD on templates)
 *
 * Inner tab state is just local — no URL sync. Switching the inner tab
 * doesn't reload data either, since the parent server component already
 * fetched everything we need.
 */
export function GastosFijosPanel({
  month,
  templates,
  paymentsForMonth,
}: {
  month: string;
  templates: ExpenseTemplateRow[];
  paymentsForMonth: ExpenseRow[];
}) {
  const activeCount = templates.filter((t) => t.active).length;

  return (
    <Tabs defaultValue="pagos-mes" className="space-y-4">
      <TabsList>
        <TabsTrigger value="pagos-mes">
          Pagos del mes
          <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
            {activeCount}
          </span>
        </TabsTrigger>
        <TabsTrigger value="catalogo">
          Catálogo
          <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
            {templates.length}
          </span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="pagos-mes" className="space-y-4">
        <PagosMesPanel
          month={month}
          templates={templates}
          paymentsForMonth={paymentsForMonth}
        />
      </TabsContent>

      <TabsContent value="catalogo" className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground max-w-2xl">
            Plantillas de gastos recurrentes. El monto lo cargás cuando lo
            pagás desde la pestaña <strong>Pagos del mes</strong>.
          </p>
          <NewTemplateButton />
        </div>
        <TemplatesList templates={templates} />
      </TabsContent>
    </Tabs>
  );
}
