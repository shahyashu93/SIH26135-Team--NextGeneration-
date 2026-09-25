import { demoEnabled } from "@/server/security";
import { Login } from "@/components/login";
export const dynamic = "force-dynamic";
export default function LoginPage() { return <Login demo={demoEnabled()} />; }