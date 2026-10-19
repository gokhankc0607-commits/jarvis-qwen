import os from "os";
import { headers } from "next/headers";
import { randomBytes } from "crypto";
import { and, like, lt } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { withUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Telefon eşleştirme: tek kullanımlık, 10 dk geçerli QR bağlantısı üretir. */
export async function GET() {
  return withUser(async (u) => {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
    const port = host.includes(":") ? host.split(":").pop()! : proto === "https" ? "443" : "80";
    const isLocal = /^(localhost|127\.|\[::1\]|::1)/.test(host);

    const token = "pair_" + randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.delete(sessions).where(and(like(sessions.id, "pair_%"), lt(sessions.expiresAt, new Date())));
    await db.insert(sessions).values({ id: token, userId: u.id, expiresAt });

    const bases: { label: string; base: string }[] = [];
    if (!isLocal) bases.push({ label: "Panel adresi", base: `${proto}://${host}` });
    else {
      for (const [name, list] of Object.entries(os.networkInterfaces())) {
        for (const a of list ?? []) {
          if (a.family !== "IPv4" || a.internal) continue;
          if (a.address.startsWith("169.254.")) continue; // APIPA
          bases.push({ label: name, base: `http://${a.address}:${port}` });
        }
      }
      // 192.168.x.x ağlarını öne al (ev Wi-Fi)
      bases.sort((x, y) => Number(y.base.includes("//192.168.")) - Number(x.base.includes("//192.168.")));
    }

    const urls = await Promise.all(
      bases.map(async (b) => {
        const link = `${b.base}/api/auth/pair?t=${token}`;
        const qr = await QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: "#041226", light: "#ffffff" } });
        return { ...b, link, qr };
      })
    );
    return Response.json({ urls, expiresAt, local: isLocal, port });
  });
}
