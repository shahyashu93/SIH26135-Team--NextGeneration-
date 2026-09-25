import { redirect } from "next/navigation";
import { actor, ApiError, demoEnabled } from "@/server/security";
import { Shell } from "@/components/shell";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await actor().catch(error => { if (error instanceof ApiError && error.status === 401) redirect("/login"); throw error; });
  return <Shell user={user} demo={demoEnabled()}>{children}</Shell>;
}