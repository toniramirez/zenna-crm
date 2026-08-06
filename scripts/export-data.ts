import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: false });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "@/types/database.types";

/**
 * Exporta toda la base a CSV + JSON para migrar a otro sistema.
 *
 *   npx tsx scripts/export-data.ts                     # todo salvo tablas efímeras
 *   npx tsx scripts/export-data.ts --all               # incluye sesión de WhatsApp
 *   npx tsx scripts/export-data.ts --tables=clients,appointments
 *   npx tsx scripts/export-data.ts --storage           # además baja el bucket wa-media
 *
 * Usa la service_role key, así que ignora RLS y baja absolutamente todas las filas.
 * Nunca corras esto en un entorno donde la key quede expuesta.
 */

const PAGE_SIZE = 1000;
const STORAGE_BUCKET = "wa-media";

type TableName = keyof Database["public"]["Tables"];

type TableSpec = {
  name: TableName;
  /** Columna estable para paginar. Sin un orden fijo, .range() puede repetir u omitir filas. */
  orderBy: string;
  group: string;
  /** Estado operativo que no tiene sentido migrar (credenciales, QR, etc.). */
  ephemeral?: boolean;
};

const TABLES: TableSpec[] = [
  // Configuración del negocio: normalmente lo primero que hay que cargar en el sistema nuevo.
  { name: "profiles", orderBy: "created_at", group: "configuracion" },
  { name: "professionals", orderBy: "created_at", group: "configuracion" },
  { name: "professional_schedules", orderBy: "id", group: "configuracion" },
  { name: "professional_time_off", orderBy: "id", group: "configuracion" },
  { name: "services", orderBy: "created_at", group: "configuracion" },
  { name: "payment_methods", orderBy: "sort_order", group: "configuracion" },
  { name: "client_tags", orderBy: "created_at", group: "configuracion" },
  { name: "quick_replies", orderBy: "created_at", group: "configuracion" },
  { name: "expense_templates", orderBy: "created_at", group: "configuracion" },
  { name: "automation_flows", orderBy: "created_at", group: "configuracion" },

  // Núcleo del CRM: clientes, agenda y plata.
  { name: "clients", orderBy: "created_at", group: "negocio" },
  { name: "appointments", orderBy: "starts_at", group: "negocio" },
  { name: "appointment_services", orderBy: "id", group: "negocio" },
  { name: "payments", orderBy: "paid_at", group: "negocio" },
  { name: "commissions", orderBy: "created_at", group: "negocio" },
  { name: "expenses", orderBy: "expense_date", group: "negocio" },
  { name: "budgets", orderBy: "created_at", group: "negocio" },
  { name: "budget_items", orderBy: "id", group: "negocio" },
  { name: "budget_payment_options", orderBy: "id", group: "negocio" },

  // Mensajería. `messages` suele ser la tabla más grande del proyecto.
  { name: "conversations", orderBy: "created_at", group: "whatsapp" },
  { name: "messages", orderBy: "sent_at", group: "whatsapp" },
  { name: "automation_executions", orderBy: "created_at", group: "whatsapp" },
  { name: "outreach_suggestions", orderBy: "created_at", group: "whatsapp" },

  // Estado del socket de Baileys: credenciales y QR. No se migra.
  { name: "whatsapp_sessions", orderBy: "key", group: "operativo", ephemeral: true },
  { name: "whatsapp_status", orderBy: "session_id", group: "operativo", ephemeral: true },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const only = args
    .find((a) => a.startsWith("--tables="))
    ?.slice("--tables=".length)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    only,
    includeEphemeral: args.includes("--all"),
    withStorage: args.includes("--storage"),
  };
}

/** Serializa un valor de Postgres a una celda CSV (RFC 4180). */
function toCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\r\n]/.test(raw)) return `"${raw.replaceAll('"', '""')}"`;
  return raw;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  // Unión de claves por si alguna fila trae columnas que otra no.
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => toCell(row[h])).join(",")),
  ];
  // BOM para que Excel abra los acentos bien.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Trae una tabla completa paginando, porque PostgREST corta en 1000 filas. */
async function fetchAll(
  supabase: SupabaseClient<Database>,
  spec: TableSpec,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(spec.name)
      .select("*")
      .order(spec.orderBy, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`${spec.name}: ${error.message}`);
    if (!data || data.length === 0) break;

    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE_SIZE) break;
    process.stdout.write(`\r  ${spec.name}: ${rows.length} filas…`);
  }

  return rows;
}

/** Baja todos los archivos del bucket de media (audios, imágenes, avatares). */
async function downloadStorage(
  supabase: SupabaseClient<Database>,
  outDir: string,
): Promise<{ files: number; failed: string[] }> {
  const failed: string[] = [];
  let files = 0;

  async function walk(prefix: string) {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });

      if (error) throw new Error(`storage list "${prefix}": ${error.message}`);
      if (!data || data.length === 0) break;

      for (const entry of data) {
        const full = prefix ? `${prefix}/${entry.name}` : entry.name;
        // Las carpetas vienen sin metadata/id; los archivos sí lo traen.
        if (!entry.id) {
          await walk(full);
          continue;
        }

        const { data: blob, error: dlError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .download(full);

        if (dlError || !blob) {
          failed.push(full);
          continue;
        }

        const dest = path.join(outDir, full);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, Buffer.from(await blob.arrayBuffer()));
        files += 1;
        process.stdout.write(`\r  storage: ${files} archivos…`);
      }

      if (data.length < 100) break;
    }
  }

  await walk("");
  return { files, failed };
}

async function main() {
  const { only, includeEphemeral, withStorage } = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error(
      "❌ Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env.local",
    );
    process.exit(1);
  }

  const supabase = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const outDir = path.join(process.cwd(), "export", stamp);
  await mkdir(path.join(outDir, "csv"), { recursive: true });
  await mkdir(path.join(outDir, "json"), { recursive: true });

  const selected = TABLES.filter((t) => {
    if (only) return only.includes(t.name);
    return includeEphemeral || !t.ephemeral;
  });

  if (selected.length === 0) {
    console.error("❌ Ninguna tabla coincide con --tables");
    process.exit(1);
  }

  console.log(`\n📦 Exportando ${selected.length} tablas a export/${stamp}\n`);

  const summary: Record<string, number> = {};
  const errors: string[] = [];

  for (const spec of selected) {
    try {
      const rows = await fetchAll(supabase, spec);
      summary[spec.name] = rows.length;

      await writeFile(
        path.join(outDir, "json", `${spec.name}.json`),
        JSON.stringify(rows, null, 2),
      );
      await writeFile(path.join(outDir, "csv", `${spec.name}.csv`), toCsv(rows));

      console.log(`\r  ✓ ${spec.name.padEnd(24)} ${rows.length} filas`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      console.log(`\r  ✗ ${spec.name.padEnd(24)} ${message}`);
    }
  }

  let storage: { files: number; failed: string[] } | null = null;
  if (withStorage) {
    console.log(`\n📎 Bajando bucket "${STORAGE_BUCKET}"…`);
    try {
      storage = await downloadStorage(supabase, path.join(outDir, "storage"));
      console.log(`\r  ✓ storage${" ".repeat(18)} ${storage.files} archivos`);
      if (storage.failed.length > 0) {
        console.log(`  ⚠ ${storage.failed.length} archivos fallaron`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      console.log(`\r  ✗ storage: ${message}`);
    }
  }

  await writeFile(
    path.join(outDir, "_resumen.json"),
    JSON.stringify(
      {
        exportado_en: new Date().toISOString(),
        proyecto: url,
        tablas: summary,
        total_filas: Object.values(summary).reduce((a, b) => a + b, 0),
        storage,
        errores: errors,
      },
      null,
      2,
    ),
  );

  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  console.log(`\n✅ ${total} filas en export/${stamp}`);
  if (errors.length > 0) {
    console.log(`⚠️  ${errors.length} tabla(s) con error — mirá _resumen.json`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
