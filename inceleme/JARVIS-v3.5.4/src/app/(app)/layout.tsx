import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await getUser();
  if (!u) redirect("/login");
  return (
    <ToastProvider>
      <div className="pointer-events-none fixed inset-0 grid-bg" />
      <div className="relative flex min-h-screen flex-col lg:flex-row">
        <Sidebar name={u.name} email={u.email} />
        <main className="min-w-0 flex-1 p-4 md:p-6 xl:p-8">{children}</main>
      </div>
    </ToastProvider>
  );
}
