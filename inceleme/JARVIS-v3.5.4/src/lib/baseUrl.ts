import { headers } from "next/headers";

/** Panelin dışarıdan erişilebilir adresi (Telegram buton bağlantıları için). */
export async function panelUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
  return `${proto}://${host}`;
}
