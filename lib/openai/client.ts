/**
 * Minimal OpenAI Chat Completions wrapper. We hit the REST endpoint with fetch
 * to avoid pulling the `openai` SDK as a dependency — the surface we need is
 * tiny (one POST, JSON in/out) and the API is stable.
 *
 * OPENAI_API_KEY must be set in `.env.local`. Throws a clear error otherwise so
 * the server action can surface it to the user instead of leaking a 401.
 */

export const DEFAULT_MODEL = "gpt-4o-mini";

export class OpenAIError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "OpenAIError";
  }
}

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionOptions = {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  /** When true, instructs the model to emit a single JSON object. */
  jsonMode?: boolean;
  /** AbortSignal for cancellation/timeouts. */
  signal?: AbortSignal;
};

type ChatCompletionResponse = {
  choices: {
    message: { role: string; content: string | null };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export async function chatCompletion(
  opts: ChatCompletionOptions,
): Promise<{ content: string; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OpenAIError(
      "Falta OPENAI_API_KEY en .env.local. Configurá la key para usar la IA.",
    );
  }

  const model = opts.model ?? DEFAULT_MODEL;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OpenAIError(
      `OpenAI respondió ${res.status}: ${text.slice(0, 300)}`,
      res.status,
    );
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new OpenAIError("OpenAI devolvió una respuesta vacía.");
  }

  return { content, model };
}
