import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/dm-sans";
import "./globals.css";

export const metadata: Metadata = { title: "SkillPulse Maharashtra | Outcome Intelligence", description: "SIH26135 hackathon prototype. Longitudinal skilling outcome intelligence using clearly labeled synthetic Maharashtra data.", robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }