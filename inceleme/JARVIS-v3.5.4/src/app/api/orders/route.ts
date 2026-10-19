import { withUser, num } from "@/lib/api";
import { createManualOrder } from "@/lib/orders";

/** Hızlı Emir: kullanıcı "Emri gönder"e bilerek basar — açık onay. Ajan gönderimden önce yeniden doğrular. */
export async function POST(req: Request) {
  return withUser(async (u) => {
    const b = await req.json();
    const side = b.side === "SELL" ? "SELL" : b.side === "BUY" ? "BUY" : null;
    if (!side) throw new Error("Yön seçin (AL / SAT)");
    const { signal, live } = await createManualOrder(u.id, {
      symbol: String(b.symbol ?? ""), side, volume: num(b.volume, 0.1) ?? 0.1,
      sl: num(b.sl), tp: num(b.tp), slPips: num(b.slPips), tpPips: num(b.tpPips),
    }, true);
    return Response.json({ ...signal, live });
  });
}
