import { withUser } from "@/lib/api";
import { saveTg, tgCfg } from "@/lib/telegram";

export async function GET() {
  return withUser(async (u) => {
    const c = await tgCfg(u.id);
    return Response.json({ ...c, botToken: c.botToken ? "••••" + c.botToken.slice(-6) : "" });
  });
}

export async function PATCH(req: Request) {
  return withUser(async (u) => {
    const b = await req.json();
    return Response.json(await saveTg(u.id, b));
  });
}
