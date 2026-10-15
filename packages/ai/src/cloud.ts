/**
 * IA en ligne : Claude (payant, principal), Groq et Mistral (gratuits, secours), puis Ollama sur le PC.
 * Chaque client a la même forme que OllamaClient (model, status, chatJson) : les tâches (analyse, lettre…) ne changent pas.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AiUnavailableError, OllamaClient, parseJsonReply, toTurns, type AiStatus, type ChatOptions, type ChatTurn, type FetchLike } from "./ollama";

export type AiClient = {
  readonly model: string;
  /** IA payante : la lettre se contente d'une version et d'une correction (chaque appel coûte). */
  readonly paid?: boolean;
  status(): Promise<AiStatus>;
  chatJson(system: string, user: string | ChatTurn[], jsonSchema: object, opts?: ChatOptions): Promise<unknown>;
};

type Log = (msg: string) => void;

/** Prix Claude en $ par million de tokens (entrée, sortie), pour afficher le coût de chaque appel dans le journal. */
const CLAUDE_PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
};

/** Claude exige « additionalProperties: false » sur chaque objet du schéma ; les schémas des tâches ne le mettent pas. */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = strictSchema(v);
  const type = (schema as { type?: unknown }).type;
  if (type === "object" || (Array.isArray(type) && type.includes("object"))) out.additionalProperties = false;
  return out;
}

export class ClaudeClient implements AiClient {
  readonly model: string;
  readonly paid = true;
  private readonly client: Anthropic;
  private readonly effort: "low" | "medium" | "high";
  private readonly log: Log | undefined;

  constructor(opts: { apiKey: string; model: string; effort: "low" | "medium" | "high"; timeoutMs?: number; log?: Log }) {
    this.model = opts.model;
    this.effort = opts.effort;
    this.log = opts.log;
    this.client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 180_000, maxRetries: 1 });
  }

  // Pas d'appel réseau : un appel coûte, et une clé refusée bascule de toute façon sur le secours.
  async status(): Promise<AiStatus> {
    return { available: true, model: this.model, installed: true };
  }

  async chatJson(system: string, user: string | ChatTurn[], jsonSchema: object, opts: ChatOptions = {}): Promise<unknown> {
    // cache : la consigne et la première demande (CV, annonce) sont relues à 10 % du prix pendant 5 minutes.
    const messages: Anthropic.MessageParam[] = toTurns(user).map((t, i) =>
      i === 0 && opts.cache ? { role: t.role, content: [{ type: "text", text: t.content, cache_control: { type: "ephemeral" } }] } : t,
    );
    let res: Anthropic.Message;
    try {
      res = await this.client.messages.create({
        model: this.model,
        max_tokens: 16_000,
        system,
        messages,
        output_config: {
          effort: this.effort,
          format: { type: "json_schema", schema: strictSchema(jsonSchema) as Record<string, unknown> },
        },
      });
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new AiUnavailableError(`Claude répond en erreur (HTTP ${err.status ?? "?"}) ${err.message.slice(0, 200)}`.trim());
      }
      throw new AiUnavailableError("Claude ne répond pas (connexion ou délai dépassé).");
    }
    if (res.stop_reason === "refusal") throw new AiUnavailableError("Claude a refusé de répondre.");
    if (res.stop_reason === "max_tokens") throw new Error("Réponse de Claude coupée (trop longue).");
    const [inPrice, outPrice] = CLAUDE_PRICES[this.model] ?? [0, 0];
    const u = res.usage;
    const written = u.cache_creation_input_tokens ?? 0;
    const read = u.cache_read_input_tokens ?? 0;
    // Cache : écrit à 125 % du prix, relu à 10 %.
    const cents = (((u.input_tokens + written * 1.25 + read * 0.1) * inPrice + u.output_tokens * outPrice) / 1e6) * 100;
    const cached = written || read ? ` (cache : ${written} écrits, ${read} relus)` : "";
    this.log?.(`IA ${this.model} : ${u.input_tokens + written + read} → ${u.output_tokens} tokens${cached} (~${cents.toFixed(2)} centime $)`);
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return parseJsonReply(text);
  }
}

/** Groq et Mistral parlent le même format (celui d'OpenAI). */
export class OpenAiCompatClient implements AiClient {
  readonly model: string;
  constructor(
    private readonly opts: { name: string; baseUrl: string; apiKey: string; model: string; extra?: object; timeoutMs?: number; fetch?: FetchLike },
  ) {
    this.model = opts.model;
  }

  async status(): Promise<AiStatus> {
    return { available: true, model: this.model, installed: true };
  }

  async chatJson(system: string, user: string | ChatTurn[], jsonSchema: object, opts: ChatOptions = {}): Promise<unknown> {
    const fetch = this.opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    let res: Response;
    try {
      res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 180_000),
        body: JSON.stringify({
          model: this.model,
          temperature: opts.temperature ?? 0.2,
          response_format: { type: "json_schema", json_schema: { name: "reponse", schema: jsonSchema, strict: false } },
          messages: [{ role: "system", content: system }, ...toTurns(user)],
          ...this.opts.extra,
        }),
      });
    } catch {
      throw new AiUnavailableError(`${this.opts.name} ne répond pas (connexion ou délai dépassé).`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AiUnavailableError(`${this.opts.name} répond en erreur (HTTP ${res.status}) ${detail.slice(0, 200)}`.trim());
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parseJsonReply(body.choices?.[0]?.message?.content ?? "");
  }
}

/** Essaie chaque IA dans l'ordre : la suivante prend le relais si la précédente échoue (crédit épuisé, limite, panne…). */
export class FallbackAi implements AiClient {
  private last: string;
  constructor(
    private readonly clients: AiClient[],
    private readonly log?: Log,
  ) {
    if (clients.length === 0) throw new Error("FallbackAi : aucune IA.");
    this.last = clients[0]!.model;
  }

  get paid(): boolean {
    return this.clients[0]!.paid ?? false;
  }

  /** Modèle qui a répondu au dernier appel (le premier de la liste avant tout appel). */
  // ponytail: partagé entre appels simultanés, un résultat peut porter le nom d'un autre modèle ; à passer par appel si ça gêne.
  get model(): string {
    return this.last;
  }

  async status(): Promise<AiStatus> {
    let first: AiStatus | undefined;
    for (const c of this.clients) {
      const s = await c.status();
      if (s.available && s.installed) return s;
      first ??= s;
    }
    return first!;
  }

  async chatJson(system: string, user: string | ChatTurn[], jsonSchema: object, opts?: ChatOptions): Promise<unknown> {
    let lastErr: unknown;
    for (const c of this.clients) {
      try {
        const out = await c.chatJson(system, user, jsonSchema, opts);
        this.last = c.model;
        return out;
      } catch (err) {
        lastErr = err;
        this.log?.(`IA ${c.model} indisponible : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw lastErr;
  }
}

/**
 * IA d'une tâche selon les clés du .env : Claude (ANTHROPIC_API_KEY), puis Ollama Cloud (OLLAMA_API_KEY), Groq
 * (GROQ_API_KEY, analyses seulement) et Mistral (MISTRAL_API_KEY). Sans aucune clé : Ollama sur ce PC, comme avant ;
 * avec une clé, il n'est plus utilisé (le serveur n'a pas de carte graphique).
 */
export function aiChain(
  env: Record<string, string | undefined>,
  task: "general" | "letter",
  log?: Log,
): AiClient {
  const key = (name: string) => env[name]?.trim() || undefined;
  const letter = task === "letter";
  const timeoutMs = letter ? 300_000 : 180_000;
  const clients: AiClient[] = [];
  const anthropic = key("ANTHROPIC_API_KEY");
  if (anthropic) {
    clients.push(
      new ClaudeClient({
        apiKey: anthropic,
        model: letter ? "claude-sonnet-5-5" : "claude-haiku-5-5",
        effort: letter ? "medium" : "low",
        timeoutMs,
        ...(log ? { log } : {}),
      }),
    );
  }
  const ollamaCloud = key("OLLAMA_API_KEY");
  if (ollamaCloud) clients.push(new OllamaClient({ baseUrl: "https://ollama.com", apiKey: ollamaCloud, model: "gpt-oss:120b", timeoutMs }));
  const groq = key("GROQ_API_KEY");
  // Pas pour la lettre : sa demande (~11 000 tokens) dépasse la limite gratuite de Groq (8 000 tokens par minute).
  if (groq && !letter) {
    clients.push(
      new OpenAiCompatClient({ name: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: groq, model: "openai/gpt-oss-120b", extra: { reasoning_effort: "low" } }),
    );
  }
  const mistral = key("MISTRAL_API_KEY");
  if (mistral) {
    clients.push(new OpenAiCompatClient({ name: "Mistral", baseUrl: "https://api.mistral.ai/v1", apiKey: mistral, model: "ministral-14b-latest" }));
  }
  if (clients.length > 0) return clients.length === 1 ? clients[0]! : new FallbackAi(clients, log);
  const letterModel = key("OLLAMA_LETTER_MODEL");
  return letter && letterModel
    ? new OllamaClient({ baseUrl: env.OLLAMA_URL, model: letterModel, timeoutMs: 300_000 })
    : new OllamaClient({ baseUrl: env.OLLAMA_URL, model: env.OLLAMA_MODEL });
}
