"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  RotateCcw,
  Star,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { REVIEW_CASE_THRESHOLD } from "@/lib/reviews";
import { cn } from "@/lib/utils";
import {
  reopenCaseAction,
  resolveCaseAction,
  saveCaseNotesAction,
} from "./actions";
import type { ReviewRequestRow } from "./types";

/**
 * Bandeja de las encuestas de reseña.
 *
 * Está ordenada por lo que hay que hacer, no por lo que pasó: primero los
 * casos abiertos (un puntaje bajo esperando respuesta del salón), después el
 * resto como contexto. Una reseña de 5 no pide nada de nadie, así que vive en
 * la pestaña "Todas" y solo suma al promedio.
 */
export function ResenasView({ requests }: { requests: ReviewRequestRow[] }) {
  const openCases = requests.filter((r) => r.case_status === "open");
  const answered = requests.filter((r) => r.score !== null);

  const stats = useMemo(() => {
    if (answered.length === 0) {
      return { average: null as number | null, fives: 0 };
    }
    const total = answered.reduce((acc, r) => acc + (r.score ?? 0), 0);
    return {
      average: total / answered.length,
      fives: answered.filter((r) => r.score === 5).length,
    };
  }, [answered]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reseñas</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Lo que contestaron las clientas a la encuesta del 1 al 5 que sale
            después de cobrar el turno. Un puntaje de {REVIEW_CASE_THRESHOLD} o
            menos abre un caso para resolver en privado, antes de que se
            convierta en una reseña pública.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Promedio"
          value={stats.average === null ? "—" : stats.average.toFixed(1)}
          hint={`${answered.length} respuesta${answered.length === 1 ? "" : "s"}`}
        />
        <Stat
          label="Puntajes de 5"
          value={String(stats.fives)}
          hint="Van al link de Google"
        />
        <Stat
          label="Casos abiertos"
          value={String(openCases.length)}
          hint="Esperando respuesta del salón"
          accent={openCases.length > 0}
        />
      </div>

      <Tabs defaultValue="casos" className="space-y-4">
        <TabsList>
          <TabsTrigger value="casos">
            Casos abiertos
            {openCases.length > 0 ? (
              <Badge className="ml-1.5 text-[10px]">{openCases.length}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="todas">Todas</TabsTrigger>
        </TabsList>

        <TabsContent value="casos" className="space-y-3">
          {openCases.length === 0 ? (
            <Empty
              title="Ningún caso abierto."
              body="Cuando una clienta puntúe bajo, va a aparecer acá para que la contactes."
            />
          ) : (
            openCases.map((r) => <ReviewCard key={r.id} request={r} />)
          )}
        </TabsContent>

        <TabsContent value="todas" className="space-y-3">
          {requests.length === 0 ? (
            <Empty
              title="Todavía no salió ninguna encuesta."
              body="Se manda sola después de cobrar un turno, si el flujo Pedido de reseña está activo."
            />
          ) : (
            requests.map((r) => <ReviewCard key={r.id} request={r} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums mt-1",
          accent && "text-destructive",
        )}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground space-y-2">
      <Star className="size-5 mx-auto text-gold" />
      <p>{title}</p>
      <p className="text-xs">{body}</p>
    </div>
  );
}

function ReviewCard({ request }: { request: ReviewRequestRow }) {
  const [notes, setNotes] = useState(request.case_notes ?? "");
  const [isPending, startTransition] = useTransition();

  const name = request.clients?.full_name ?? "Clienta sin ficha";
  const services = (request.appointments?.appointment_services ?? [])
    .map((s) => s.services?.name)
    .filter(Boolean)
    .join(" + ");

  const when = request.answered_at ?? request.asked_at;
  const isOpen = request.case_status === "open";
  const isResolved = request.case_status === "resolved";

  function run(fn: () => Promise<{ error?: string }>, ok: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) toast.error(result.error);
      else toast.success(ok);
    });
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 space-y-3",
        isOpen && "border-destructive/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="font-medium truncate">{name}</div>
          <div className="text-xs text-muted-foreground">
            {format(parseISO(when), "d 'de' MMMM, HH:mm", { locale: es })}
            {services ? ` · ${services}` : ""}
            {request.appointments?.professionals?.full_name
              ? ` · ${request.appointments.professionals.full_name}`
              : ""}
          </div>
        </div>
        <ScoreBadge score={request.score} />
      </div>

      {request.feedback ? (
        <div className="rounded-md bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">
          {request.feedback}
        </div>
      ) : request.score !== null && request.score <= 4 ? (
        <p className="text-xs text-muted-foreground italic">
          Todavía no contó qué pasó.
        </p>
      ) : null}

      {isResolved ? (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5 mt-0.5 shrink-0 text-emerald-600" />
          <span>
            Resuelto
            {request.resolved_at
              ? ` el ${format(parseISO(request.resolved_at), "d 'de' MMMM", { locale: es })}`
              : ""}
            {request.case_notes ? `: ${request.case_notes}` : "."}
          </span>
        </div>
      ) : null}

      {isOpen ? (
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Qué hiciste para resolverlo (la clienta no lo ve)."
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {request.conversation_id ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/crm?c=${request.conversation_id}`}>
              <MessageCircle className="size-3.5" />
              Abrir chat
            </Link>
          </Button>
        ) : null}

        {isOpen ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending || notes === (request.case_notes ?? "")}
              onClick={() =>
                run(() => saveCaseNotesAction(request.id, notes), "Nota guardada.")
              }
            >
              Guardar nota
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={() =>
                run(
                  () => resolveCaseAction(request.id, notes),
                  "Caso cerrado.",
                )
              }
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              Marcar resuelto
            </Button>
          </>
        ) : null}

        {isResolved ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(() => reopenCaseAction(request.id), "Caso reabierto.")
            }
          >
            <RotateCcw className="size-3.5" />
            Reabrir
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <Badge variant="outline" className="shrink-0 text-[11px] font-normal">
        Sin responder
      </Badge>
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums",
        score >= 5
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : score >= 4
            ? "bg-gold-soft text-foreground"
            : "bg-destructive/15 text-destructive",
      )}
    >
      <Star className="size-3.5 fill-current" />
      {score}
    </div>
  );
}
