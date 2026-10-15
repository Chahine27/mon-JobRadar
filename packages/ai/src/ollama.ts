/**
 * IA locale via Ollama (https://ollama.com) : tourne sur le PC, gratuit, rien ne sort de la machine.
 * On parle à l'API locale d'Ollama (http://127.0.0.1:11434 par défaut).
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type AiStatus =
  | { available: true; model: string; installed: true }
  | { available: true; model: string; installed: false; message: string }
  | { available: false; model: string; message: string };

/** Un message d'une conversation (correction d'une lettre : la demande, la première version, puis les problèmes). */
export type ChatTurn = { role: "user" | "assistant"; content: string };

/** cache : le début de la demande sera renvoyé tel quel (correction d'une lettre) ; seul Claude s'en sert. */
export type ChatOptions = { temperature?: number; contextTokens?: number; cache?: boolean };

export const toTurns = (user: string | ChatTurn[]): ChatTurn[] => (typeof user === "string" ? [{ role: "user", content: user }] : user);

export class AiUnavailableError extends Error {
  readonly code = "AI_UNAVAILABLE";
}

export type OllamaOptions = {
  baseUrl?: string;
  model?: string;
  /** Ollama Cloud (https://ollama.com) : clé du compte ; sans clé, Ollama installé sur ce PC. */
  apiKey?: string;
  fetch?: FetchLike;
  /** Mémoire de travail du modèle (tokens). 12288 = une annonce + un CV + la lettre exemple + les règles du candidat. */
  contextTokens?: number;
  timeoutMs?: number;
};

export const OLLAMA_DEFAULTS = {
  baseUrl: "http://127.0.0.1:11434",
  model: "gemma4:e4b",
  contextTokens: 12_288,
  timeoutMs: 180_000,
};

export class OllamaClient {
  readonly baseUrl: string;
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly fetch: FetchLike;
  private readonly contextTokens: number;
  private readonly timeoutMs: number;

  constructor(opts: OllamaOptions = {}) {
    this.baseUrl = (opts.baseUrl?.trim() || OLLAMA_DEFAULTS.baseUrl).replace(/\/+$/, "");
    this.model = opts.model?.trim() || OLLAMA_DEFAULTS.model;
    this.apiKey = opts.apiKey?.trim() || undefined;
    this.fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.contextTokens = opts.contextTokens ?? OLLAMA_DEFAULTS.contextTokens;
    this.timeoutMs = opts.timeoutMs ?? OLLAMA_DEFAULTS.timeoutMs;
  }

  /** Ollama lancé ? Modèle téléchargé ? (réponse rapide, pour l'affichage) */
  async status(): Promise<AiStatus> {
    // En ligne : rien à télécharger, une clé refusée bascule de toute façon sur le secours.
    if (this.apiKey) return { available: true, model: this.model, installed: true };
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    } catch {
      return { available: false, model: this.model, message: "Ollama ne répond pas : lance l'appli Ollama sur ce PC." };
    }
    if (!res.ok) return { available: false, model: this.model, message: `Ollama répond en erreur (HTTP ${res.status}).` };
    const body = (await res.json().catch(() => ({}))) as { models?: Array<{ name?: string; model?: string }> };
    const names = (body.models ?? []).flatMap((m) => [m.name, m.model]).filter((n): n is string => typeof n === "string");
    const wanted = this.model.includes(":") ? this.model : `${this.model}:latest`;
    if (names.includes(wanted) || names.includes(this.model)) return { available: true, model: this.model, installed: true };
    return {
      available: true,
      model: this.model,
      installed: false,
      message: `Modèle « ${this.model} » pas encore téléchargé : lance « ollama pull ${this.model} ».`,
    };
  }

  /**
   * Demande une réponse au format JSON imposé (schéma JSON), sans la « réflexion » du modèle (plus rapide).
   * Renvoie le JSON brut (à valider par l'appelant).
   */
  async chatJson(system: string, user: string | ChatTurn[], jsonSchema: object, opts: ChatOptions = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          stream: false,
          think: false,
          format: jsonSchema,
          options: { temperature: opts.temperature ?? 0.2, num_ctx: opts.contextTokens ?? this.contextTokens },
          messages: [{ role: "system", content: system }, ...toTurns(user)],
        }),
      });
    } catch (err) {
      const timeout = err instanceof Error && err.name === "TimeoutError";
      throw new AiUnavailableError(
        timeout ? "L'IA a mis trop de temps à répondre." : this.apiKey ? "Ollama Cloud ne répond pas." : "Ollama ne répond pas : lance l'appli Ollama sur ce PC.",
      );
    }
    if (res.status === 404 && !this.apiKey) {
      throw new AiUnavailableError(`Modèle « ${this.model} » introuvable : lance « ollama pull ${this.model} ».`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AiUnavailableError(`${this.apiKey ? "Ollama Cloud" : "Ollama"} répond en erreur (HTTP ${res.status}) ${detail.slice(0, 200)}`.trim());
    }
    const body = (await res.json()) as { message?: { content?: string } };
    return parseJsonReply(body.message?.content ?? "");
  }
}

/** JSON de la réponse ; certains modèles l'entourent de ```json … ``` malgré la consigne. */
export function parseJsonReply(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Réponse de l'IA illisible (pas du JSON).");
  }
}
