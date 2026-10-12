/**
 * IA locale via Ollama (https://ollama.com) : tourne sur le PC, gratuit, rien ne sort de la machine.
 * On parle à l'API locale d'Ollama (http://127.0.0.1:11434 par défaut).
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type AiStatus =
  | { available: true; model: string; installed: true }
  | { available: true; model: string; installed: false; message: string }
  | { available: false; model: string; message: string };

export class AiUnavailableError extends Error {
  readonly code = "AI_UNAVAILABLE";
}

export type OllamaOptions = {
  baseUrl?: string;
  model?: string;
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
  private readonly fetch: FetchLike;
  private readonly contextTokens: number;
  private readonly timeoutMs: number;

  constructor(opts: OllamaOptions = {}) {
    this.baseUrl = (opts.baseUrl?.trim() || OLLAMA_DEFAULTS.baseUrl).replace(/\/+$/, "");
    this.model = opts.model?.trim() || OLLAMA_DEFAULTS.model;
    this.fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.contextTokens = opts.contextTokens ?? OLLAMA_DEFAULTS.contextTokens;
    this.timeoutMs = opts.timeoutMs ?? OLLAMA_DEFAULTS.timeoutMs;
  }

  /** Ollama lancé ? Modèle téléchargé ? (réponse rapide, pour l'affichage) */
  async status(): Promise<AiStatus> {
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
  async chatJson(system: string, user: string, jsonSchema: object, opts: { temperature?: number; contextTokens?: number } = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          stream: false,
          think: false,
          format: jsonSchema,
          options: { temperature: opts.temperature ?? 0.2, num_ctx: opts.contextTokens ?? this.contextTokens },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
    } catch (err) {
      const timeout = err instanceof Error && err.name === "TimeoutError";
      throw new AiUnavailableError(
        timeout ? "L'IA a mis trop de temps à répondre." : "Ollama ne répond pas : lance l'appli Ollama sur ce PC.",
      );
    }
    if (res.status === 404) {
      throw new AiUnavailableError(`Modèle « ${this.model} » introuvable : lance « ollama pull ${this.model} ».`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AiUnavailableError(`Ollama répond en erreur (HTTP ${res.status}) ${detail.slice(0, 200)}`.trim());
    }
    const body = (await res.json()) as { message?: { content?: string } };
    const content = body.message?.content ?? "";
    try {
      return JSON.parse(content);
    } catch {
      // Certains modèles entourent le JSON de ```json … ``` malgré la consigne.
      const m = content.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error("Réponse de l'IA illisible (pas du JSON).");
    }
  }
}
