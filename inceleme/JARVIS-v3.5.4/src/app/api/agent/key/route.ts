import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { newAgentKey } from "@/lib/auth";
import { withUser } from "@/lib/api";

export async function POST() {
  return withUser(async (u) => {
    const agentKey = newAgentKey();
    await db.update(users).set({ agentKey }).where(eq(users.id, u.id));
    return Response.json({ agentKey });
  });
}
