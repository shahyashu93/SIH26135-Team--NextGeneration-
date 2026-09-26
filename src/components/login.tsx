"use client";
import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, ArrowRight, ShieldCheck, Building2, GraduationCap, Landmark, BriefcaseBusiness, Settings2 } from "lucide-react";
import { api } from "@/lib/client";
import { Button } from "./ui/button";
import { Badge, ErrorState } from "./ui/common";

export const roleHome: Record<string, string> = { ADMIN: "/", OFFICER: "/", PROVIDER: "/programs", EMPLOYER: "/employer", TRAINEE: "/my-profile" };
const roles = [{ id: "OFFICER", name: "Government Officer", icon: Landmark }, { id: "PROVIDER", name: "Training Provider", icon: Building2 }, { id: "EMPLOYER", name: "Employer", icon: BriefcaseBusiness }, { id: "TRAINEE", name: "Trainee", icon: GraduationCap }, { id: "ADMIN", name: "Administrator", icon: Settings2 }];
export function Login({ demo }: { demo: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget); setBusy("login"); setError("");
    try { const user = await api<{ role: string }>("auth/login", { email: values.get("email"), password: values.get("password") }); router.push(roleHome[user.role]); router.refresh(); } catch (error) { setError((error as Error).message); setBusy(""); }
  }
  async function demoLogin(role: string) {
    setBusy(role); setError("");
    try { await api("auth/demo", { role }); router.push(roleHome[role]); router.refresh(); } catch (error) { setError((error as Error).message); setBusy(""); }
  }
  return <main className="login-page"><div className="login-brand"><div className="brand-mark"><Activity size={27} /></div><span>SkillPulse <small>MAHARASHTRA</small></span></div><div className="login-layout"><section className="login-intro"><Badge tone="green">SIH 2026 / SIH26135</Badge><h1>SkillPulse<br />Maharashtra</h1><p className="login-subtitle">Skilling Outcome Intelligence</p><div className="login-photo" role="img" aria-label="Solar panels representing renewable-energy skilling in Maharashtra" /><div className="login-footnote"><ShieldCheck size={18} /><span>Consent-led. Evidence-backed.</span></div></section><section className="login-form"><h2>Sign in to your workspace</h2><p>Welcome back to SkillPulse.</p>{(error || searchParams.get("error")) && <ErrorState message={error || searchParams.get("error")!} />}<form onSubmit={signIn} className="form-stack"><label>Email address<input type="email" name="email" autoComplete="username" required placeholder="you@organisation.in" /></label><label>Password<input type="password" name="password" autoComplete="current-password" required /></label><Button disabled={Boolean(busy)} type="submit">{busy === "login" ? "Signing in..." : "Sign in"}<ArrowRight size={17} /></Button></form>{demo && <div className="demo-access"><div className="section-label"><span>DEMO WORKSPACES</span><Badge tone="amber">Synthetic data</Badge></div><div className="demo-roles">{roles.map(role => <button key={role.id} onClick={() => demoLogin(role.id)} disabled={Boolean(busy)}><role.icon size={19} /><span>{role.name}</span><ArrowRight size={16} /></button>)}</div><p className="fine-print">Sandbox access only. Admin and officer credentials are predefined for this demo. No real trainee or government records.</p></div>}</section></div><footer>Smart India Hackathon 2026 prototype <span>Not an official government service</span></footer></main>;
}