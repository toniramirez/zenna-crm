import { format } from "date-fns";
import { es } from "date-fns/locale";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { applySurcharge } from "@/lib/validations/budgets";

// Brand palette — kept inline rather than from CSS vars since jsPDF needs
// concrete RGB triples. Matches the cream/ink/champagne look used in
// `app/globals.css`.
const COLOR_INK: [number, number, number] = [28, 25, 23];
const COLOR_MUTED: [number, number, number] = [120, 113, 108];
const COLOR_BORDER: [number, number, number] = [228, 218, 200];
const COLOR_CREAM_BG: [number, number, number] = [251, 247, 240];
const COLOR_GOLD: [number, number, number] = [184, 153, 104];
const COLOR_GOLD_SOFT: [number, number, number] = [217, 199, 165];

export type BudgetPdfPayload = {
  clientName: string;
  clientPhone: string | null;
  notes: string | null;
  items: { name: string; priceMin: number; priceMax: number }[];
  paymentOptions: {
    label: string;
    surchargePercent: number;
    installments: number | null;
  }[];
  createdAt: Date;
};

const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmt(n: number): string {
  return ARS.format(n);
}

function fmtRange(min: number, max: number): string {
  if (min === max) return fmt(min);
  return `${fmt(min)} — ${fmt(max)}`;
}

/**
 * Fetch /zenna-logo.png and return it as a base64 data URL so jsPDF can
 * embed it via addImage(). Returns null if the asset can't be loaded —
 * the PDF still renders fine without a logo, just with a text header.
 */
async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch("/zenna-logo.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Read the natural pixel dimensions of an image data URL so we can
 * preserve aspect ratio when placing the logo on the page.
 */
function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });
}

/**
 * Decorative gold ornament — two short hairlines flanking a small filled
 * dot. Used to break sections without resorting to a heavy ruler. Looks
 * good on cream and gives the document a salon-stationery feel.
 */
function drawOrnament(doc: jsPDF, cx: number, y: number, totalWidth = 60) {
  const dotR = 0.9;
  const gap = 3; // breathing room between line and dot
  doc.setDrawColor(...COLOR_GOLD);
  doc.setLineWidth(0.3);
  doc.line(cx - totalWidth / 2, y, cx - dotR - gap, y);
  doc.line(cx + dotR + gap, y, cx + totalWidth / 2, y);
  doc.setFillColor(...COLOR_GOLD);
  doc.circle(cx, y, dotR, "F");
}

/**
 * Small-caps section label in gold, with letter spacing for a refined feel.
 */
function drawSectionLabel(doc: jsPDF, text: string, x: number, y: number) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_GOLD);
  doc.setCharSpace(1.4);
  doc.text(text.toUpperCase(), x, y);
  doc.setCharSpace(0);
}

/**
 * Draw a horizontally-centered string with extra character spacing.
 *
 * jsPDF's `text(..., { align: "center" })` measures the natural string
 * width but does NOT account for the active `setCharSpace`, so spaced
 * text drifts to the right of the requested center. We compute the
 * actual visual width and lay it out manually.
 */
function drawCenteredSpacedText(
  doc: jsPDF,
  text: string,
  cx: number,
  y: number,
  charSpace: number,
) {
  doc.setCharSpace(charSpace);
  const natural = doc.getTextWidth(text);
  const visual = natural + Math.max(0, text.length - 1) * charSpace;
  doc.text(text, cx - visual / 2, y);
  doc.setCharSpace(0);
}

/**
 * Render the salon's budget PDF and return it as a Blob so the caller
 * decides whether to download it, attach it to a message, or both.
 *
 * Layout (A4, units = mm):
 *   ┌───────────────────────────────────────────────────────┐
 *   │  [LOGO]                                ZENNA          │
 *   │                                        Salón de belleza│
 *   │                                                       │
 *   │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
 *   │  PRESUPUESTO                  N° abcd1234             │
 *   │  Para: Juana Pérez                 11 may 2026         │
 *   │  +54 9 351 555-1234                                   │
 *   │                                                       │
 *   │  Servicios                                            │
 *   │  ┌─────────────────────────────────────────────────┐ │
 *   │  │ Servicio                          Precio        │ │
 *   │  │ Corte                             $120 — $150   │ │
 *   │  ...                                                  │
 *   │  Subtotal                            $120 — $150     │
 *   │                                                       │
 *   │  Medios de pago                                       │
 *   │  ┌─────────────────────────────────────────────────┐ │
 *   │  │ Medio                Recargo       Total        │ │
 *   │  │ Efectivo             —             $120 — $150  │ │
 *   │  │ Tarjeta 3 cuotas    +15%          $138 — $173   │ │
 *   │  ...                                                  │
 *   │  Notas: ...                                           │
 *   │                                                       │
 *   │  Presupuesto válido por 7 días                        │
 *   └───────────────────────────────────────────────────────┘
 */
export async function buildBudgetPdf(
  payload: BudgetPdfPayload,
): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 22;
  const cx = pageW / 2;

  // ─── Full-page cream wash ────────────────────────────────────────────
  // The whole page is tinted cream — matches the in-app aesthetic and
  // avoids the hard horizontal cutoff a banded header creates. The cream
  // is faint enough that prices, ink-on-cream, stay readable.
  doc.setFillColor(...COLOR_CREAM_BG);
  doc.rect(0, 0, pageW, pageH, "F");

  let y = 24;

  // ─── Centered logo ───────────────────────────────────────────────────
  const logo = await loadLogoDataUrl();
  if (logo) {
    const { w, h } = await imageSize(logo);
    const targetH = 26;
    const targetW = w > 0 && h > 0 ? (w / h) * targetH : targetH;
    const x = (pageW - targetW) / 2;
    try {
      doc.addImage(logo, "PNG", x, y, targetW, targetH);
    } catch {
      // Fall back silently if addImage chokes.
    }
    y += targetH;
  }

  y += 8;

  // Gold ornament under the logo
  drawOrnament(doc, cx, y, 56);
  y += 14;

  // ─── Title — serif, centered, letter-spaced ──────────────────────────
  doc.setFont("times", "normal");
  doc.setFontSize(26);
  doc.setTextColor(...COLOR_INK);
  drawCenteredSpacedText(doc, "PRESUPUESTO", cx, y, 3);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(
    format(payload.createdAt, "d 'de' MMMM 'de' yyyy", { locale: es }),
    cx,
    y,
    { align: "center" },
  );

  y += 16;

  // ─── Client block ────────────────────────────────────────────────────
  drawSectionLabel(doc, "Para", marginX, y);
  y += 6;

  doc.setFont("times", "normal");
  doc.setFontSize(15);
  doc.setTextColor(...COLOR_INK);
  doc.text(payload.clientName, marginX, y);
  y += 5;

  if (payload.clientPhone) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(payload.clientPhone, marginX, y);
    y += 4;
  }

  y += 8;

  // Soft hairline divider
  doc.setDrawColor(...COLOR_GOLD_SOFT);
  doc.setLineWidth(0.2);
  doc.line(marginX, y, pageW - marginX, y);
  y += 10;

  // ─── Servicios ───────────────────────────────────────────────────────
  drawSectionLabel(doc, "Servicios", marginX, y);
  y += 6;

  const totalMin = payload.items.reduce((acc, i) => acc + i.priceMin, 0);
  const totalMax = payload.items.reduce((acc, i) => acc + i.priceMax, 0);

  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    body: payload.items.map((it) => [
      it.name,
      fmtRange(it.priceMin, it.priceMax),
    ]),
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 10.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 0, right: 0 },
      textColor: COLOR_INK,
      fillColor: false as never,
      lineColor: COLOR_BORDER,
      lineWidth: { bottom: 0.15 } as never,
    },
    columnStyles: {
      0: { halign: "left" },
      1: { halign: "right" },
    },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
    .finalY + 4;

  // Subtotal row — serif, gold hairline above for emphasis
  doc.setDrawColor(...COLOR_GOLD_SOFT);
  doc.setLineWidth(0.25);
  doc.line(marginX, y, pageW - marginX, y);
  y += 7;

  doc.setFont("times", "italic");
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_MUTED);
  doc.text("Subtotal", marginX, y);

  doc.setFont("times", "normal");
  doc.setFontSize(13);
  doc.setTextColor(...COLOR_INK);
  doc.text(fmtRange(totalMin, totalMax), pageW - marginX, y, {
    align: "right",
  });

  y += 12;

  // Soft divider before payment block
  doc.setDrawColor(...COLOR_GOLD_SOFT);
  doc.setLineWidth(0.2);
  doc.line(marginX, y, pageW - marginX, y);
  y += 10;

  // ─── Medios de pago ──────────────────────────────────────────────────
  drawSectionLabel(doc, "Medios de pago", marginX, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    body: payload.paymentOptions.map((opt) => {
      const sMin = applySurcharge(totalMin, opt.surchargePercent);
      const sMax = applySurcharge(totalMax, opt.surchargePercent);
      const surchargeLabel =
        opt.surchargePercent === 0
          ? "—"
          : `${opt.surchargePercent > 0 ? "+" : ""}${opt.surchargePercent}%`;
      let totalLabel = fmtRange(sMin, sMax);
      // For installment plans, append a per-installment hint using the
      // midpoint so the customer sees a rough monthly figure.
      if (opt.installments && opt.installments > 1) {
        const mid = Math.round((sMin + sMax) / 2 / opt.installments);
        totalLabel += `\n${opt.installments} × ~${fmt(mid)}`;
      }
      return [opt.label, surchargeLabel, totalLabel];
    }),
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 10.5,
      cellPadding: { top: 4, bottom: 4, left: 0, right: 0 },
      textColor: COLOR_INK,
      fillColor: false as never,
      lineColor: COLOR_BORDER,
      lineWidth: { bottom: 0.15 } as never,
    },
    columnStyles: {
      0: { halign: "left" },
      1: { halign: "right", cellWidth: 26, textColor: COLOR_GOLD },
      2: { halign: "right", cellWidth: 60 },
    },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
    .finalY + 10;

  // ─── Notes (optional) ────────────────────────────────────────────────
  if (payload.notes && payload.notes.trim().length > 0) {
    doc.setDrawColor(...COLOR_GOLD_SOFT);
    doc.setLineWidth(0.2);
    doc.line(marginX, y, pageW - marginX, y);
    y += 9;

    drawSectionLabel(doc, "Notas", marginX, y);
    y += 6;

    doc.setFont("times", "italic");
    doc.setFontSize(10.5);
    doc.setTextColor(...COLOR_INK);
    const wrapped = doc.splitTextToSize(
      payload.notes.trim(),
      pageW - marginX * 2,
    ) as string[];
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 5 + 6;
  }

  // ─── Footer ──────────────────────────────────────────────────────────
  // Same ornament we used under the logo, mirrored at the bottom for symmetry.
  drawOrnament(doc, cx, pageH - 22, 56);

  doc.setFont("times", "italic");
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(
    "Presupuesto válido por 7 días — el precio final depende del largo del cabello.",
    cx,
    pageH - 15,
    { align: "center" },
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLOR_MUTED);
  drawCenteredSpacedText(
    doc,
    `Generado el ${format(payload.createdAt, "d/MM/yyyy 'a las' HH:mm", { locale: es }).toUpperCase()}`,
    cx,
    pageH - 10,
    0.8,
  );

  return doc.output("blob");
}

/**
 * Pick a friendly default filename for the downloaded PDF. Strips
 * accents/spaces so it survives Windows' aggressive filename sanitizer.
 */
export function budgetPdfFilename(
  clientName: string,
  createdAt: Date,
): string {
  const slug = clientName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const datePart = format(createdAt, "yyyy-MM-dd");
  return `presupuesto-${slug || "cliente"}-${datePart}.pdf`;
}

export function budgetImageFilename(
  clientName: string,
  createdAt: Date,
): string {
  return budgetPdfFilename(clientName, createdAt).replace(/\.pdf$/, ".png");
}

// ──────────────────────────────────────────────────────────────────────────
//  PNG version (sent via WhatsApp as an image)
//
// Some recipient WhatsApp clients render captioned-PDF messages as
// "Esperando este mensaje…" because Baileys wraps them as the newer
// `documentWithCaptionMessage` protocol shape. Sending the same budget
// as a regular image side-steps the issue entirely and shows inline in
// the chat — no tap-to-open. The PDF flow is kept for downloads.
// ──────────────────────────────────────────────────────────────────────────

const IMG_W = 1240; // ≈ A4 width @ ~150 DPI
const IMG_H = 1754; // A4 ratio

function rgb([r, g, b]: [number, number, number]) {
  return `rgb(${r}, ${g}, ${b})`;
}

async function loadLogoImage(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "/zenna-logo.png";
  });
}

/**
 * Canvas-side ornament mirror of `drawOrnament` for the PDF: two short
 * gold hairlines flanking a small filled dot.
 */
function drawOrnamentCanvas(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  totalWidth: number,
) {
  const dotR = 5;
  const gap = 12;
  ctx.strokeStyle = rgb(COLOR_GOLD);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - totalWidth / 2, y);
  ctx.lineTo(cx - dotR - gap, y);
  ctx.moveTo(cx + dotR + gap, y);
  ctx.lineTo(cx + totalWidth / 2, y);
  ctx.stroke();
  ctx.fillStyle = rgb(COLOR_GOLD);
  ctx.beginPath();
  ctx.arc(cx, y, dotR, 0, Math.PI * 2);
  ctx.fill();
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number) {
  // letterSpacing is widely supported (Chrome 99+, Safari 16.4+, FF 112+).
  // If the runtime is older the property assignment is just a no-op.
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

function drawSectionLabelCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
) {
  ctx.fillStyle = rgb(COLOR_GOLD);
  ctx.font = "500 18px Helvetica, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  setLetterSpacing(ctx, 3);
  ctx.fillText(text.toUpperCase(), x, y);
  setLetterSpacing(ctx, 0);
}

/**
 * Render the salon budget to a PNG `Blob`. The layout intentionally
 * mirrors the PDF (cream background, gold ornament, serif title, hairline
 * table dividers) but at canvas-native sizes so the image looks crisp in
 * WhatsApp's inline preview.
 */
export async function buildBudgetImage(
  payload: BudgetPdfPayload,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = IMG_W;
  canvas.height = IMG_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible en este navegador.");

  // High-quality image scaling for the logo.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // ─── Full-page cream wash ────────────────────────────────────────────
  ctx.fillStyle = rgb(COLOR_CREAM_BG);
  ctx.fillRect(0, 0, IMG_W, IMG_H);

  const marginX = 130;
  const cx = IMG_W / 2;
  let y = 130;

  // ─── Centered logo ───────────────────────────────────────────────────
  const logo = await loadLogoImage();
  if (logo && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
    const targetH = 170;
    const ratio = logo.naturalWidth / logo.naturalHeight;
    const targetW = targetH * ratio;
    const x = (IMG_W - targetW) / 2;
    ctx.drawImage(logo, x, y, targetW, targetH);
    y += targetH;
  }

  y += 36;

  // Ornament under the logo
  drawOrnamentCanvas(ctx, cx, y, 320);
  y += 70;

  // ─── Title PRESUPUESTO — serif, letter-spaced ────────────────────────
  ctx.fillStyle = rgb(COLOR_INK);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "400 64px 'Times New Roman', Times, serif";
  setLetterSpacing(ctx, 16);
  // Compensate for letterSpacing not affecting textAlign centering:
  // measureText already includes letterSpacing in modern browsers, so
  // align: center works correctly here.
  ctx.fillText("PRESUPUESTO", cx, y);
  setLetterSpacing(ctx, 0);
  y += 50;

  ctx.fillStyle = rgb(COLOR_MUTED);
  ctx.font = "400 22px Helvetica, Arial, sans-serif";
  ctx.fillText(
    format(payload.createdAt, "d 'de' MMMM 'de' yyyy", { locale: es }),
    cx,
    y,
  );

  y += 80;

  // ─── Client block ────────────────────────────────────────────────────
  drawSectionLabelCanvas(ctx, "Para", marginX, y);
  y += 38;

  ctx.fillStyle = rgb(COLOR_INK);
  ctx.font = "400 36px 'Times New Roman', Times, serif";
  ctx.textAlign = "left";
  ctx.fillText(payload.clientName, marginX, y);
  y += 32;

  if (payload.clientPhone) {
    ctx.fillStyle = rgb(COLOR_MUTED);
    ctx.font = "400 22px Helvetica, Arial, sans-serif";
    ctx.fillText(payload.clientPhone, marginX, y);
    y += 26;
  }

  y += 36;

  // Soft hairline
  ctx.strokeStyle = rgb(COLOR_GOLD_SOFT);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(marginX, y);
  ctx.lineTo(IMG_W - marginX, y);
  ctx.stroke();
  y += 50;

  // ─── Servicios ───────────────────────────────────────────────────────
  drawSectionLabelCanvas(ctx, "Servicios", marginX, y);
  y += 50;

  const totalMin = payload.items.reduce((acc, i) => acc + i.priceMin, 0);
  const totalMax = payload.items.reduce((acc, i) => acc + i.priceMax, 0);

  const rowH = 52;
  ctx.font = "400 24px Helvetica, Arial, sans-serif";
  ctx.fillStyle = rgb(COLOR_INK);
  for (const item of payload.items) {
    ctx.textAlign = "left";
    ctx.fillText(item.name, marginX, y);
    ctx.textAlign = "right";
    ctx.fillText(fmtRange(item.priceMin, item.priceMax), IMG_W - marginX, y);

    // Hairline under each row
    ctx.strokeStyle = rgb(COLOR_BORDER);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(marginX, y + 18);
    ctx.lineTo(IMG_W - marginX, y + 18);
    ctx.stroke();
    y += rowH;
  }

  y += 12;
  // Gold-soft separator above subtotal
  ctx.strokeStyle = rgb(COLOR_GOLD_SOFT);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(marginX, y);
  ctx.lineTo(IMG_W - marginX, y);
  ctx.stroke();
  y += 44;

  ctx.fillStyle = rgb(COLOR_MUTED);
  ctx.font = "italic 400 26px 'Times New Roman', Times, serif";
  ctx.textAlign = "left";
  ctx.fillText("Subtotal", marginX, y);
  ctx.fillStyle = rgb(COLOR_INK);
  ctx.font = "400 30px 'Times New Roman', Times, serif";
  ctx.textAlign = "right";
  ctx.fillText(fmtRange(totalMin, totalMax), IMG_W - marginX, y);

  y += 56;

  // Soft divider before payment block
  ctx.strokeStyle = rgb(COLOR_GOLD_SOFT);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(marginX, y);
  ctx.lineTo(IMG_W - marginX, y);
  ctx.stroke();
  y += 50;

  // ─── Medios de pago ──────────────────────────────────────────────────
  drawSectionLabelCanvas(ctx, "Medios de pago", marginX, y);
  y += 50;

  for (const opt of payload.paymentOptions) {
    const sMin = applySurcharge(totalMin, opt.surchargePercent);
    const sMax = applySurcharge(totalMax, opt.surchargePercent);
    const surchargeLabel =
      opt.surchargePercent === 0
        ? "—"
        : `${opt.surchargePercent > 0 ? "+" : ""}${opt.surchargePercent}%`;
    const totalLabel = fmtRange(sMin, sMax);
    const installmentsLabel =
      opt.installments && opt.installments > 1
        ? `${opt.installments} × ~${fmt(Math.round((sMin + sMax) / 2 / opt.installments))}`
        : null;

    // Method label
    ctx.fillStyle = rgb(COLOR_INK);
    ctx.font = "400 24px Helvetica, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(opt.label, marginX, y);

    // Surcharge in gold, right-aligned at ~70% width
    ctx.fillStyle = rgb(COLOR_GOLD);
    ctx.font = "500 22px Helvetica, Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(surchargeLabel, IMG_W - marginX - 360, y);

    // Total range, far right
    ctx.fillStyle = rgb(COLOR_INK);
    ctx.font = "400 24px Helvetica, Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(totalLabel, IMG_W - marginX, y);

    if (installmentsLabel) {
      ctx.fillStyle = rgb(COLOR_MUTED);
      ctx.font = "400 18px Helvetica, Arial, sans-serif";
      ctx.fillText(installmentsLabel, IMG_W - marginX, y + 24);
      y += 28;
    }

    // Hairline under row
    ctx.strokeStyle = rgb(COLOR_BORDER);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(marginX, y + 18);
    ctx.lineTo(IMG_W - marginX, y + 18);
    ctx.stroke();
    y += rowH;
  }

  y += 8;

  // ─── Notes (optional) ────────────────────────────────────────────────
  if (payload.notes && payload.notes.trim().length > 0) {
    ctx.strokeStyle = rgb(COLOR_GOLD_SOFT);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(marginX, y);
    ctx.lineTo(IMG_W - marginX, y);
    ctx.stroke();
    y += 44;

    drawSectionLabelCanvas(ctx, "Notas", marginX, y);
    y += 38;

    ctx.fillStyle = rgb(COLOR_INK);
    ctx.font = "italic 400 22px 'Times New Roman', Times, serif";
    ctx.textAlign = "left";
    // Simple word-wrap to keep the notes inside the safe margins.
    const maxW = IMG_W - marginX * 2;
    const words = payload.notes.trim().split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW) {
        ctx.fillText(line, marginX, y);
        y += 30;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, marginX, y);
      y += 30;
    }
  }

  // ─── Footer ──────────────────────────────────────────────────────────
  // Bottom ornament + tagline + generated-on line, mirroring the PDF.
  drawOrnamentCanvas(ctx, cx, IMG_H - 130, 320);

  ctx.fillStyle = rgb(COLOR_MUTED);
  ctx.font = "italic 400 22px 'Times New Roman', Times, serif";
  ctx.textAlign = "center";
  ctx.fillText(
    "Presupuesto válido por 7 días — el precio final depende del largo del cabello.",
    cx,
    IMG_H - 80,
  );

  ctx.font = "400 18px Helvetica, Arial, sans-serif";
  setLetterSpacing(ctx, 3);
  ctx.fillText(
    `Generado el ${format(payload.createdAt, "d/MM/yyyy 'a las' HH:mm", { locale: es }).toUpperCase()}`,
    cx,
    IMG_H - 46,
  );
  setLetterSpacing(ctx, 0);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No pudimos convertir el canvas a imagen."));
          return;
        }
        resolve(blob);
      },
      "image/png",
      0.95,
    );
  });
}
