import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export const number = (value: number) => value.toLocaleString("en-IN");
export const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
export const date = (value: string | Date) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
export const label = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());