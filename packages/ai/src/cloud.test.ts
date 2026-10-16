import { describe, expect, it } from "vitest";
import { FallbackAi, OllamaClient, OpenAiCompatClient, aiChain, strictSchema, type AiClient } from "./index";
import { AiUnavailableError } from "./ollama";

const fake = (model: string, reply: () => unknown): AiClient => ({
  model,
  status: async () => ({ available: true, model, installed: true }),
  chatJson: async () => reply(),
});

describe("FallbackAi", () => {
  it("passe à l'IA suivante quand la première échoue, et donne le modèle qui a répondu", async () => {
    const logs: string[] = [];
    const ai = new FallbackAi(
      [
        fake("claude", () => {
          throw new AiUnavailableError("crédit épuisé");
        }),
        fake("groq", () => ({ ok: true })),
      ],
      (m) => logs.push(m),
    );
    expect(ai.model).toBe("claude");
    expect(await ai.chatJson("s", "u", {})).toEqual({ ok: true });
    expect(ai.model).toBe("groq");
    expect(logs[0]).toContain("crédit épuisé");
  });

  it("renvoie la dernière erreur quand toutes échouent", async () => {
    const ai = new FallbackAi([
      fake("a", () => {
        throw new Error("a");
      }),
      fake("b", () => {
        throw new AiUnavailableError("b");
      }),
    ]);
    await expect(ai.chatJson("s", "u", {})).rejects.toThrow("b");
  });
});

describe("strictSchema", () => {
  it("ajoute additionalProperties: false à chaque objet", () => {
    const s = strictSchema({ type: "object", properties: { a: { type: "array", items: { type: "object", properties: {} } } } });
    expect(s).toEqual({
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "array", items: { type: "object", properties: {}, additionalProperties: false } } },
    });
  });
});

describe("OpenAiCompatClient", () => {
  it("lit le JSON de la réponse et signale une erreur HTTP comme une IA indisponible", async () => {
    let body: Record<string, unknown> = {};
    const ok = new OpenAiCompatClient({
      name: "Groq",
      baseUrl: "https://x",
      apiKey: "k",
      model: "m",
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"a":1}\n```' } }] }));
      },
    });
    expect(await ok.chatJson("s", "u", { type: "object" })).toEqual({ a: 1 });
    expect(body.model).toBe("m");
    const ko = new OpenAiCompatClient({ name: "Groq", baseUrl: "https://x", apiKey: "k", model: "m", fetch: async () => new Response("", { status: 429 }) });
    await expect(ko.chatJson("s", "u", {})).rejects.toBeInstanceOf(AiUnavailableError);
  });
});

describe("aiChain", () => {
  it("sans clé : Ollama seul ; avec la clé Claude : Haiku pour le reste, Sonnet pour la lettre", () => {
    expect(aiChain({}, "general")).toBeInstanceOf(OllamaClient);
    expect(aiChain({ ANTHROPIC_API_KEY: "k" }, "general").model).toBe("claude-haiku-5-5");
    expect(aiChain({ ANTHROPIC_API_KEY: "k" }, "letter").model).toBe("claude-sonnet-5-5");
    expect(aiChain({ GROQ_API_KEY: "k" }, "general").model).toBe("openai/gpt-oss-120b");
    expect(aiChain({ OLLAMA_API_KEY: "k" }, "letter").model).toBe("gpt-oss:120b");
    // Mails : jamais Claude, même avec sa clé.
    expect(aiChain({ ANTHROPIC_API_KEY: "k", OLLAMA_API_KEY: "k" }, "mail").model).toBe("gpt-oss:120b");
    // Lettres spontanées : jamais Claude, et pas Groq (lettre trop longue pour sa limite gratuite).
    expect(aiChain({ ANTHROPIC_API_KEY: "k", OLLAMA_API_KEY: "k" }, "free-letter").model).toBe("gpt-oss:120b");
    expect(aiChain({ ANTHROPIC_API_KEY: "k", GROQ_API_KEY: "k" }, "free-letter").model).toBe("gemma4:e4b");
    // Groq ne prend pas la lettre (trop longue pour sa limite gratuite) : seul Ollama sur le PC reste.
    expect(aiChain({ GROQ_API_KEY: "k" }, "letter").model).toBe("gemma4:e4b");
  });

  it("Ollama Cloud : clé envoyée, rien à télécharger", async () => {
    let auth = "";
    const cloud = new OllamaClient({
      baseUrl: "https://ollama.com",
      apiKey: "k",
      model: "gpt-oss:120b",
      fetch: async (_u, init) => {
        auth = String((init?.headers as Record<string, string>).Authorization);
        return new Response(JSON.stringify({ message: { content: '{"a":1}' } }));
      },
    });
    expect(await cloud.status()).toEqual({ available: true, model: "gpt-oss:120b", installed: true });
    expect(await cloud.chatJson("s", "u", {})).toEqual({ a: 1 });
    expect(auth).toBe("Bearer k");
  });
});
