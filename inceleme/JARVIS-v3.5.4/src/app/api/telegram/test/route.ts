import { withUser } from "@/lib/api";
import { testTg } from "@/lib/telegram";

export async function POST() {
  return withUser(async (u) => Response.json(await testTg(u.id)));
}
