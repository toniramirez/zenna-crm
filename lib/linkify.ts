export type TextPart =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

/*
  Lo que WhatsApp convierte en link: lo que arranca con http(s):// o www., y
  los dominios sueltos ("zenna.com.ar/turnos", "bit.ly/abc"). Para los
  sueltos sólo se aceptan terminaciones conocidas: en castellano un punto sin
  espacio ("llegué.me voy") no tiene que volverse link.

  El lookbehind evita agarrar el dominio de un mail ("ana@gmail.com").
*/
const BARE_TLDS =
  "com|net|org|ar|io|app|ai|dev|info|ly|gl|shop|store|site|online|link|page";
const LINK_RE = new RegExp(
  String.raw`(?<![@\w.-])(?:(?:https?:\/\/|www\.)[^\s<>]+|(?:[a-z0-9-]+\.)+(?:${BARE_TLDS})(?![\w-])(?:[/?#][^\s<>]*)?)`,
  "gi",
);

/** Puntuación que cierra la oración, no el link: "mirá https://x.com." */
const TRAILING = /[.,;:!?¡¿'"…»*_~]$/;

function trimTrailing(url: string): string {
  let out = url;
  for (;;) {
    if (TRAILING.test(out)) {
      out = out.slice(0, -1);
      continue;
    }
    // Un paréntesis de cierre es del link sólo si el link abrió uno
    // ("es.wikipedia.org/wiki/Tango_(música)"); si no, es del texto.
    const last = out.at(-1);
    const pair = last === ")" ? "(" : last === "]" ? "[" : null;
    if (pair && out.split(pair).length <= out.split(last!).length - 1) {
      out = out.slice(0, -1);
      continue;
    }
    return out;
  }
}

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const value = trimTrailing(match[0]);
    // "www." pelado, o un link que se quedó sin nada después del recorte.
    if (!/[a-z0-9]\.[a-z]/i.test(value)) continue;
    const start = match.index;
    if (start > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, start) });
    }
    const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    parts.push({ type: "link", value, href });
    cursor = start + value.length;
  }
  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) });
  }
  return parts;
}
