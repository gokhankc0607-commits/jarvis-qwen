import { withUser } from "@/lib/api";
import { cryptoCfg, maskCrypto, saveCrypto } from "@/lib/cryptoStore";
import { getAgentInfo, getCryptoAccount, getCryptoMarketWatch } from "@/lib/live";

export const dynamic = "force-dynamic";

export async function GET() {
  return withUser(async (u) => {
    const c = await cryptoCfg(u.id);
    const info = getAgentInfo(u.id);
    return Response.json({
      ...maskCrypto(c),
      agentConnected: !!info?.crypto,
      agentLabel: info?.cryptoLabel ?? "",
      account: getCryptoAccount(u.id),
      marketWatch: getCryptoMarketWatch(u.id),
    });
  });
}

export async function PATCH(req: Request) {
  return withUser(async (u) => Response.json(maskCrypto(await saveCrypto(u.id, await req.json()))));
}
