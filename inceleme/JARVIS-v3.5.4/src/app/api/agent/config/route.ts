import { headers } from "next/headers";
import { withUser } from "@/lib/api";
import { buildConfig, dashboardUrl } from "@/lib/agentConfig";

export async function GET() {
  return withUser(async (u) => {
    const body = await buildConfig(dashboardUrl(await headers()), u.agentKey);
    return new Response(body, {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="config.json"' },
    });
  });
}
