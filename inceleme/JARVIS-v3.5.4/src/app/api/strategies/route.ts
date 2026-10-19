import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { strategies } from "@/db/schema";
import { withUser } from "@/lib/api";
import { ensureKanalStrategies } from "@/lib/kanalStore";

const TEMPLATE = (name: string) => `//+------------------------------------------------------------------+
//| ${name}.mq5 - JARVIS tarafından oluşturuldu
//+------------------------------------------------------------------+
#property copyright "JARVIS"
#property version   "1.00"

#include <Trade\\Trade.mqh>

input double InpLots  = 0.10;
input ulong  InpMagic = 990099;

CTrade trade;

int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagic);
   return(INIT_SUCCEEDED);
  }

void OnTick()
  {
   // Strateji kurallarını buraya ekleyin veya JARVIS'ten isteyin.
  }
`;

export async function GET() {
  return withUser(async (u) => {
    await ensureKanalStrategies(u.id);
    const rows = await db.select().from(strategies).where(eq(strategies.userId, u.id)).orderBy(desc(strategies.updatedAt));
    return Response.json(rows);
  });
}

export async function POST(req: Request) {
  return withUser(async (u) => {
    const b = await req.json();
    const name = String(b.name ?? "").trim();
    if (!name) throw new Error("Strateji adı gerekli");
    const safe = name.replace(/[^\w]+/g, "_");
    const [row] = await db
      .insert(strategies)
      .values({
        userId: u.id,
        name,
        filePath: String(b.filePath || `MQL5\\Experts\\Jarvis\\${safe}.mq5`),
        description: String(b.description || ""),
        code: String(b.code || TEMPLATE(safe)),
      })
      .returning();
    return Response.json(row);
  });
}
