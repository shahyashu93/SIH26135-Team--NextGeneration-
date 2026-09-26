"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, LayoutDashboard, MapPinned, GraduationCap, Users, CalendarCheck, BrainCircuit, Sparkles, FileText, ShieldCheck, Play, Building2, LogOut, Menu, Bell, ChevronRight, Landmark } from "lucide-react";
import type { Actor } from "@/server/security";
import { api, useResource } from "@/lib/client";
import { label } from "@/lib/utils";
import { roleHome } from "./login";
import { Button } from "./ui/button";
import { Badge, ErrorState } from "./ui/common";

const navigation = [
  { href: "/", title: "Outcome overview", icon: LayoutDashboard, roles: ["ADMIN","OFFICER","PROVIDER"] },
  { href: "/districts", title: "District outcomes", icon: MapPinned, roles: ["ADMIN","OFFICER","PROVIDER"] },
  { href: "/programs", title: "Programmes & providers", icon: GraduationCap, roles: ["ADMIN","OFFICER","PROVIDER"] },
  { href: "/trainees", title: "Trainee directory", icon: Users, roles: ["ADMIN","PROVIDER"] },
  { href: "/my-profile", title: "My SkillID", icon: GraduationCap, roles: ["TRAINEE"] },
  { href: "/followups", title: "Outcome follow-ups", icon: CalendarCheck, roles: ["ADMIN","PROVIDER","TRAINEE"] },
  { href: "/employer", title: "Employment verification", icon: Building2, roles: ["EMPLOYER"] },
  { href: "/intelligence", title: "Skill intelligence", icon: BrainCircuit, roles: ["ADMIN","OFFICER","PROVIDER"] },
  { href: "/advisor", title: "AI Advisor", icon: Sparkles, roles: ["ADMIN","OFFICER","PROVIDER"] },
  { href: "/reports", title: "Impact reports", icon: FileText, roles: ["ADMIN","OFFICER","PROVIDER"] },
  { href: "/audit", title: "Audit trail", icon: ShieldCheck, roles: ["ADMIN"] }
];
export function Shell({ user, demo, children }: { user: Actor; demo: boolean; children: ReactNode }) {
  const path = usePathname(); const router = useRouter(); const [open, setOpen] = useState(false); const [notificationsOpen, setNotificationsOpen] = useState(false); const [error, setError] = useState("");
  const notifications = useResource<{ id: string; title: string; body: string; read: boolean }[]>("notifications");
  async function signOut() { try { await api("auth/logout", {}); router.push("/login"); router.refresh(); } catch (error) { setError((error as Error).message); } }
  const current = navigation.find(item => item.href === path)?.title ?? (path.startsWith("/trainees/") ? "Trainee profile" : "Demo journey");
  return <>{open && <button className="mobile-scrim" onClick={() => setOpen(false)} aria-label="Close navigation" />}<aside className={`sidebar ${open ? "open" : ""}`}><Link href={roleHome[user.role]} className="brand"><div className="brand-mark"><Activity size={25} /></div><div><strong>SkillPulse</strong><small>MAHARASHTRA</small></div></Link><div className="workspace-label"><Landmark size={16} /><div><span>Skilling Outcome Intelligence</span><small>SIH26135 / Maharashtra</small></div></div><div className="nav-group">WORKSPACE</div><nav className="nav-links" aria-label="Workspace navigation">{navigation.filter(item => item.roles.includes(user.role)).map(item => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`nav-link ${path === item.href ? "active" : ""}`} aria-current={path === item.href ? "page" : undefined}><item.icon size={17} strokeWidth={1.7} />{item.title}</Link>)}{demo && <Link href="/demo" onClick={() => setOpen(false)} className={`nav-link ${path === "/demo" ? "active" : ""}`}><Play size={17} />Demo journey</Link>}</nav><div className="sidebar-bottom"><div className="sidebar-note"><strong>Skills to sustainable livelihoods.</strong><br />Smart India Hackathon 2026</div><div className="sidebar-footer"><div className="avatar">{user.name.split(" ").slice(0,2).map(word => word[0]).join("")}</div><div className="user-details"><strong>{user.name}</strong><small>{label(user.role)}</small></div><Button variant="ghost" size="icon" onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={15} /></Button></div></div></aside><div className="app-main"><header className="topbar"><Button className="mobile-menu" variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={20} /></Button><div className="breadcrumb">Workspace<ChevronRight size={12} /><strong>{current}</strong></div><div className="topbar-actions"><span className="live-status"><i />Connected workspace</span><div className="topbar-divider" /><Button variant="ghost" size="icon" onClick={() => setNotificationsOpen(!notificationsOpen)} title="Notifications" aria-label={`Notifications, ${notifications.data?.filter(item => !item.read).length ?? 0} unread`}><Bell size={17} /></Button><Badge tone="amber">SYNTHETIC DEMO</Badge></div>{notificationsOpen && <div className="notification-popover"><h3>Notifications</h3>{notifications.data?.length ? notifications.data.map(item => <div className="notification-item" key={item.id}><strong>{item.title}</strong><p>{item.body}</p></div>) : <p className="fine-print">No notifications.</p>}<Button variant="ghost" size="sm" onClick={async () => { await api("notifications/read", {}); notifications.refresh(); }}>Mark all read</Button></div>}</header><main className="content"><div className="demo-banner"><ShieldCheck size={13} /><strong>Prototype data</strong>All outcomes are synthetic, not official government statistics.<span>SIH 2026</span></div>{error && <ErrorState message={error} />}{children}<footer className="app-footer"><span>SkillPulse Maharashtra / SIH26135 / Smart India Hackathon 2026</span><span>Synthetic data. Consent-led analytics. Human-reviewed recommendations.</span></footer></main></div></>;
}