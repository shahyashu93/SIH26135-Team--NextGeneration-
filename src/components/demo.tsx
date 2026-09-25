"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/client";
import { Button } from "./ui/button";
import { Badge, ErrorState, PageHeader, Panel } from "./ui/common";
export function Demo() {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const steps = [{ title: "Training & certification", detail: "Rahul Patil / Pune / Solar PV Installer / MH-SK-2026-000001", role: "PROVIDER", path: "/trainees/rahul-patil" }, { title: "Employer confirmation", detail: "SuryaGrid Energy / starting salary INR 15,000 / four verification checks", role: "EMPLOYER", path: "/employer" }, { title: "90-day outcome check-in", detail: "Same employer / Solar PV Installer / monthly income INR 18,000 / skills in use", role: "TRAINEE", path: "/my-profile" }, { title: "Skill-gap review", detail: "Advanced Troubleshooting / assessment 48/100 / targeted practical module", role: "TRAINEE", path: "/my-profile" }, { title: "Updated outcome analytics", detail: "Confirmed retention, paired wage progression and consented skill-gap evidence", role: "OFFICER", path: "/" }, { title: "Recommended intervention & report", detail: "Human-reviewed evidence summary / descriptive, not causal impact", role: "OFFICER", path: "/reports" }];
  async function open(role: string, path: string) { setBusy(true); setError(""); try { await api("auth/demo", { role }); router.push(path); router.refresh(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }
  return <><PageHeader eyebrow="SIH26135 / Demonstration" title="Rahul's outcome journey" description="One persistent identity, from training to sustained livelihood."><Badge tone="amber">Synthetic sandbox</Badge></PageHeader>{error && <ErrorState message={error} />}<Panel title="The complete outcome loop" subtitle="Role-specific actions update the same database-backed record."><div className="steps-list">{steps.map((step,index) => <div className="step-row" key={step.title}><div className="step-number">{index+1}</div><div><h3>{step.title}</h3><p>{step.detail}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={() => open(step.role, step.path)}>Open workspace<ArrowRight size={13} /></Button></div>)}</div></Panel></>;
}