import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiProviders } from "@/db/schema";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };
export type Provider = typeof aiProviders.$inferSelect;

function trimSlash(s: string) {
  return s.replace(/\/+$/, "");
}

export async function getActiveProvider(userId: number) {
  const rows = await db
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.userId, userId), eq(aiProviders.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

/** Calls any supported LLM backend. Local first (Ollama / LM Studio / OmniRoute), cloud optional. */
export async function callLLM(p: Provider, msgs: ChatMsg[], timeoutMs = 60000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const base = trimSlash(p.baseUrl);
  try {
    if (p.kind === "ollama") {
      const r = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: p.model, messages: msgs, stream: false }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
      const j = await r.json();
      return j.message?.content ?? "";
    }
    if (p.kind === "anthropic") {
      const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      const r = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": p.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: p.model,
          max_tokens: 4096,
          system,
          messages: msgs.filter((m) => m.role !== "system"),
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
      const j = await r.json();
      return (j.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
    }
    if (p.kind === "gemini") {
      const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      const r = await fetch(`${base}/v1beta/models/${p.model}:generateContent?key=${p.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents: msgs
            .filter((m) => m.role !== "system")
            .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
      const j = await r.json();
      return j.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text ?? "").join("") ?? "";
    }
    // openai_compat: LM Studio, OmniRoute, Hermes routers, llama.cpp server, vLLM, OpenAI, Groq, OpenRouter...
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`;
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: p.model, messages: msgs, temperature: 0.3 }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`OpenAI-uyumlu ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return j.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(t);
  }
}

export function extractCode(text: string): string {
  const m = text.match(/```(?:mql5|mq5|cpp|c\+\+|c)?\s*\n([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}
