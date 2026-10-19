import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import CommandCenter from "@/components/CommandCenter";
import Sidebar from "@/components/Sidebar";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

/** HUD komuta merkezi — açılır/kapanır kenar menüyle. */
export default async function DashboardPage() {
  const u = await getUser();
  if (!u) redirect("/login");
  return (
    <ToastProvider>
      <div className="pointer-events-none fixed inset-0 grid-bg" />
      <div className="relative flex min-h-screen flex-col lg:flex-row">
        <Sidebar name={u.name} email={u.email} />
        <main className="min-w-0 flex-1">
          <CommandCenter />
        </main>
      </div>
    </ToastProvider>
  );
}
