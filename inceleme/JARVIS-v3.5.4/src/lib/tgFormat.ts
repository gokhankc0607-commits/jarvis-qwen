import type { KanalItem } from "./kanal";
import type { Signal } from "./types";

const fx = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? "—" : n.toFixed(d));
export const tfTr = (t?: string) => (t === "MAN" ? "elle emir" : t || "?");

/**
 * Sinyal bildirim metni (saf — test edilebilir):
 * hangi kanala temas ettiği / kanal taşması, o anki RSI durumu, seviyeler ve risk/ödül.
 */
/** Sinyal bildirim metni (saf — test edilebilir). Kanal teması + RSI durumu + seviyeler. */
export function formatSignalText(s: Signal, item?: KanalItem | null): string {
  const digits = s.price > 1000 ? 2 : s.price > 50 ? 3 : 5;
  const rr = s.sl && s.tp && s.sl !== s.price ? Math.abs(s.tp - s.price) / Math.abs(s.price - s.sl) : null;
  const mkt = (s as { market?: string }).market === "crypto" ? "🪙 KRİPTO (vadeli)" : "💱 FOREX (MT5)";
  const lines = [
    `${mkt}`,
    `⚡ <b>${s.symbol} · ${tfTr(s.timeframe)}</b> — ${s.side === "BUY" ? "▲ ALIŞ" : "▼ SATIŞ"} fırsatı · güven <b>%${s.confidence}</b>`,
    `<b>Kanal:</b> ${item ? (s.side === "BUY" ? "fiyat tüm <b>alt bantların dışında</b> kapanış yaptı" : "fiyat tüm <b>üst bantların dışında</b> kapanış yaptı") : s.reason || "KANAL stratejisi"}${item ? (item.pos === "inside" ? " ve şimdi bantların <b>içine döndü</b>" : item.pos === "below" ? " (hâlâ alt bandın dışında)" : " (hâlâ üst bandın dışında)") : ""}`,
  ];
  if (item) {
    const d = s.price > 1000 ? 2 : s.price > 50 ? 3 : 5;
    lines.push(`Merkez <code>${fx(item.center, d)}</code> · Üst <code>${fx(item.bandUp, d)}</code> · Alt <code>${fx(item.bandDn, d)}</code>${item.depth ? ` · dışta ${item.depth.toFixed(2)} ATR` : ""}`);
    const rs = item.rsi === null ? "—" : `${item.rsi.toFixed(1)} ${s.side === "BUY" ? (item.rsi < 30 ? "(30 altı · aşırı satım ✓)" : "") : item.rsi > 70 ? "(70 üstü · aşırı alım ✓)" : ""}`;
    lines.push(`<b>RSI durumu:</b> ${rs} · CCI ${fx(item.cci, 0)} / mor çizgi ${fx(item.cciMa, 0)}`);
  } else if (s.reason) {
    lines.push(s.reason);
  }
  lines.push(`Giriş <code>${fx(s.price, digits)}</code> · SL <code>${fx(s.sl, digits)}</code> · TP <code>${fx(s.tp, digits)}</code>${rr ? ` · R:R 1:${rr.toFixed(1)}` : ""} · ${s.volume} lot`);
  return lines.join("\n") + "\n\n⏳ Onay bekliyor. JARVIS açık bir “Evet” demeden işlem açmaz — buradan da onaylayabilirsiniz.";
}

