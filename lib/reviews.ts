/**
 * Reglas del flujo "Pedido de reseña", compartidas por el worker (que lee la
 * respuesta de la clienta) y el panel (que muestra la vista previa). Vive
 * fuera de `lib/validations` porque no es solo validación: la interpretación
 * del puntaje es la lógica del flujo.
 */

/** Puntaje desde el cual NO se abre caso interno. 3 o menos sí abre. */
export const REVIEW_CASE_THRESHOLD = 3;

/**
 * Cuánto tiempo después de la pregunta seguimos aceptando un número como
 * respuesta a la encuesta. Pasada la ventana, un "5" suelto vuelve a ser un
 * mensaje común y lo atienden las automatizaciones de siempre.
 */
export const REVIEW_ANSWER_WINDOW_MINUTES = 72 * 60;

/**
 * Ventana para capturar el texto libre que sigue al puntaje ("¿qué pasó?").
 * Más corta que la anterior: es una conversación en caliente.
 */
export const REVIEW_FEEDBACK_WINDOW_MINUTES = 24 * 60;

export type ReviewBucket = "high" | "mid" | "low";

/** 5 → high, 3-4 → mid, 1-2 → low. Es el agrupamiento que muestra el panel. */
export function reviewBucket(score: number): ReviewBucket {
  if (score >= 5) return "high";
  if (score >= 3) return "mid";
  return "low";
}

/** Un puntaje bajo abre un caso interno para resolverlo en privado. */
export function opensCase(score: number): boolean {
  return score <= REVIEW_CASE_THRESHOLD;
}

/**
 * Después de un puntaje que no es 5 le preguntamos qué mejorar, así que lo
 * próximo que escriba es feedback y no charla suelta.
 */
export function expectsFeedback(score: number): boolean {
  return score <= 4;
}

const WORD_SCORES: Record<string, number> = {
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
};

/**
 * Palabras que pueden rodear al número sin que deje de ser una respuesta a la
 * encuesta: "le doy un 5", "5 estrellas", "4 puntos".
 */
const FILLER = new Set([
  "un",
  "una",
  "el",
  "la",
  "les",
  "le",
  "te",
  "doy",
  "pongo",
  "diria",
  "es",
  "seria",
  "de",
  "sobre",
  "estrella",
  "estrellas",
  "punto",
  "puntos",
  "puntaje",
  "obvio",
  "ok",
]);

function tokenScore(token: string): number | null {
  if (/^[1-5]$/.test(token)) return Number(token);
  return WORD_SCORES[token] ?? null;
}

/**
 * Interpreta el mensaje de la clienta como un puntaje del 1 al 5, o null si
 * no lo es.
 *
 * Se acepta en dos casos, deliberadamente asimétricos:
 *   - El mensaje ARRANCA con el número ("5", "5 todo excelente", "cinco
 *     gracias!"). Es como contesta casi todo el mundo, y lo que venga después
 *     ya es comentario.
 *   - El número está en el medio pero todo lo demás es relleno conocido
 *     ("le doy un 4", "4 estrellas").
 *
 * Ninguno de los dos vale si aparecen dos puntajes distintos: "4 o 5, no sé"
 * es una duda, no una respuesta.
 *
 * Cualquier otra cosa devuelve null y el mensaje sigue su curso normal: es
 * preferible perder una respuesta rara —que el salón ve igual en el chat— a
 * contestar la encuesta cuando la clienta en realidad estaba preguntando otra
 * cosa. La ventana de tiempo del llamador ya acota el riesgo.
 */
export function parseReviewScore(raw: string | null | undefined): number | null {
  if (!raw) return null;

  const clean = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return null;

  const tokens = clean.split(" ");

  const scores = new Set<number>();
  for (const token of tokens) {
    const score = tokenScore(token);
    if (score !== null) scores.add(score);
  }

  // Dos puntajes distintos en un mismo mensaje ("4 o 5, no sé") no son una
  // respuesta: son una duda. Se descarta antes que nada, incluso si el primero
  // abre el mensaje.
  if (scores.size > 1) return null;

  const first = tokenScore(tokens[0]);
  if (first !== null) return first;

  if (scores.size !== 1) return null;

  // El número está en el medio: solo vale si lo que lo rodea es relleno.
  for (const token of tokens) {
    if (tokenScore(token) === null && !FILLER.has(token)) return null;
  }

  return [...scores][0];
}

// ──────────────── Textos por defecto ────────────────
// Los que trae el flujo nuevo. El salón los edita y quedan guardados en la
// fila; estos solo pueblan el formulario en blanco.

export const DEFAULT_REVIEW_QUESTION = `Hola {{nombre}} 😊 Gracias por visitarnos en {{salon}}.

Queríamos saber cómo fue tu experiencia del 1 al 5.

Respondé con un número:
1 muy mala
2 mala
3 buena
4 muy buena
5 excelente`;

export const DEFAULT_REVIEW_REPLY_HIGH = `¡Qué alegría leer eso, {{nombre}}! 🥰

Nos ayuda muchísimo que hayas tenido una buena experiencia.

¿Nos dejarías una reseña en Google? Nos ayuda un montón a seguir creciendo:

{{link}}`;

export const DEFAULT_REVIEW_REPLY_MID = `Gracias por responder, {{nombre}} 😊

Nos alegra saber que tu experiencia fue buena, pero queremos seguir mejorando.

¿Nos contarías qué podríamos mejorar para la próxima?`;

export const DEFAULT_REVIEW_REPLY_LOW = `Hola {{nombre}}, lamentamos mucho que tu experiencia no haya sido la esperada.

Te pedimos disculpas 🙏

Nos gustaría saber qué pasó para poder mejorarlo. ¿Nos contarías tu opinión?`;
