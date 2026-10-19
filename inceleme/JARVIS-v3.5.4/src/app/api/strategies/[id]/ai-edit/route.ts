import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { strategies } from "@/db/schema";
import { type Ctx, withUser } from "@/lib/api";
import { callLLM, extractCode, getActiveProvider } from "@/lib/llm";

export async function POST(req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    const { instruction } = await req.json();
    if (!instruction) throw new Error("Talimat gerekli");
    const [st] = await db.select().from(strategies).where(and(eq(strategies.id, id), eq(strategies.userId, u.id)));
    if (!st) throw new Error("Bulunamadı");
    const p = await getActiveProvider(u.id);
    if (!p) throw new Error("Aktif AI sağlayıcısı yok. 'AI Sağlayıcıları' sayfasından birini etkinleştirin.");
    let out: string;
    try {
      out = await callLLM(p, [
        {
          role: "system",
          content:
            "Sen JARVIS'in MQL5 geliştirici modülüsün. Verilen .mq5 kodunu kullanıcının talimatına göre güncelle (Gann, SMC, RSI/CCI vb.). Derlenebilir, MT5 build 4000+ uyumlu, CTrade kullanan TAM kodu tek bir ```mql5 bloğu içinde döndür. Açıklama yazma.",
        },
        { role: "user", content: `Talimat: ${instruction}\n\nMevcut kod:\n\`\`\`mql5\n${st.code}\n\`\`\`` },
      ], 120000);
    } catch (e) {
      throw new Error(`${p.name} erişilemedi (${p.baseUrl}). Yerel LLM çalışıyor mu? ${(e as Error).message.slice(0, 120)}`);
    }
    const code = extractCode(out);
    if (code.length < 30) throw new Error("LLM geçerli kod döndürmedi");
    return Response.json({ code, provider: p.name });
  });
}
