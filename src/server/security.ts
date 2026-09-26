import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { compare } from "bcryptjs";
import { cookies } from "next/headers";
import type { Prisma, Role, User } from "@prisma/client";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "./db";
import { isAllowedOrigin, secureSessionCookie } from "./origin";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type Actor = Pick<User, "id" | "name" | "email" | "role" | "providerId" | "employerId" | "traineeId">;
const publicUser = { id: true, name: true, email: true, role: true, providerId: true, employerId: true, traineeId: true } as const;
export const demoEnabled = () => process.env.DEMO_MODE === "true";
const demoEmails: Partial<Record<Role, string>> = {
  ADMIN: process.env.ADMIN_EMAIL?.toLowerCase(),
  OFFICER: process.env.OFFICER_EMAIL?.toLowerCase(),
  PROVIDER: process.env.PROVIDER_EMAIL?.toLowerCase(),
  EMPLOYER: process.env.EMPLOYER_EMAIL?.toLowerCase(),
  TRAINEE: process.env.TRAINEE_EMAIL?.toLowerCase()
};
const googleIssuer = "https://accounts.google.com";
const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new ApiError(503, "Google sign-in is not configured.");
  return { clientId, clientSecret };
}
function callbackUrl() { return `${process.env.APP_ORIGIN ?? "http://localhost:3000"}/api/auth/google/callback`; }
function oauthCookieOptions(expires?: Date) {
  return { httpOnly: true, secure: secureSessionCookie(), sameSite: "lax" as const, path: "/", ...(expires ? { expires } : {}) };
}

function sessionHash(token: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new ApiError(503, "Authentication is not configured.");
  return createHmac("sha256", secret).update(token).digest("hex");
}
export async function actor(): Promise<Actor> {
  const token = (await cookies()).get("skillpulse_session")?.value;
  if (!token) throw new ApiError(401, "Please sign in to continue.");
  const session = await db.session.findUnique({ where: { id: sessionHash(token) }, include: { user: { select: { ...publicUser, active: true } } } });
  if (!session || session.expiresAt < new Date() || !session.user.active) throw new ApiError(401, "Your session has expired. Please sign in again.");
  const { active: _active, ...user } = session.user;
  void _active;
  return user;
}
export function allow(user: Actor, roles: Role[]) {
  if (!roles.includes(user.role)) throw new ApiError(403, "Your role cannot perform this action.");
}
export function traineeScope(user: Actor): Prisma.TraineeWhereInput {
  if (user.role === "ADMIN") return {};
  if (user.role === "PROVIDER" && user.providerId) return { enrollments: { some: { providerId: user.providerId } } };
  if (user.role === "TRAINEE" && user.traineeId) return { id: user.traineeId };
  throw new ApiError(403, "Individual trainee records are restricted to the trainee and their provider.");
}
export async function assertTrainee(user: Actor, id: string) {
  const trainee = await db.trainee.findFirst({ where: { AND: [{ id }, traineeScope(user)] }, select: { id: true } });
  if (!trainee) throw new ApiError(404, "Trainee not found in your authorized scope.");
}
export function assertOrigin(request: Request) {
  if (!isAllowedOrigin(request)) throw new ApiError(403, "Request origin is not allowed.");
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "Use application/json.");
}
async function createSession(user: Pick<User, "id" | "role">, method: "password" | "google" | "demo") {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 8 * 60 * 60_000);
  await db.session.create({ data: { id: sessionHash(token), userId: user.id, expiresAt } });
  (await cookies()).set("skillpulse_session", token, { ...oauthCookieOptions(expiresAt), httpOnly: true });
  await db.auditLog.create({ data: { actorId: user.id, action: method === "google" ? "GOOGLE_LOGIN" : "LOGIN", entityId: user.id, details: { method, role: user.role } } });
}

export async function login(email: string, password: string, demoRole?: Role) {
  const key = sessionHash(demoRole ? `demo:${demoRole}` : email.toLowerCase());
  const attempts = await db.auditLog.count({ where: { action: "LOGIN_ATTEMPT", entityId: key, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } } });
  if (attempts >= 20) throw new ApiError(429, "Too many sign-in attempts. Try again in 15 minutes.");
  await db.auditLog.create({ data: { action: "LOGIN_ATTEMPT", entityId: key, details: {} } });
  if (demoRole && !demoEnabled()) throw new ApiError(403, "Demo access is disabled.");
  const user = await db.user.findUnique({ where: { email: demoRole ? demoEmails[demoRole] ?? `${demoRole.toLowerCase()}@skillpulse.demo` : email.toLowerCase() } });
  const passwordMatches = await compare(password, user?.passwordHash ?? "$2b$12$C6UzMDM.H6dfI/f/IKcEe.6biwCZlwqDyNYwvXsVkMZ3dufWlLRnW");
  if (!user || !user.active || (demoRole && user.role !== demoRole) || (!demoRole && !passwordMatches)) throw new ApiError(401, "Email or password is incorrect.");
  await createSession(user, demoRole ? "demo" : "password");
  return db.user.findUnique({ where: { id: user.id }, select: publicUser });
}

export async function startGoogleLogin() {
  const { clientId } = googleConfig();
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const jar = await cookies();
  jar.set("skillpulse_google_state", state, { ...oauthCookieOptions(), maxAge: 600 });
  jar.set("skillpulse_google_nonce", nonce, { ...oauthCookieOptions(), maxAge: 600 });
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: callbackUrl(), response_type: "code", scope: "openid email profile", state, nonce, prompt: "select_account" });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}

export async function completeGoogleLogin(code: string, state: string) {
  const { clientId, clientSecret } = googleConfig();
  const jar = await cookies();
  const expectedState = jar.get("skillpulse_google_state")?.value;
  const nonce = jar.get("skillpulse_google_nonce")?.value;
  jar.delete("skillpulse_google_state");
  jar.delete("skillpulse_google_nonce");
  if (!expectedState || !nonce || expectedState.length !== state.length || !timingSafeEqual(Buffer.from(expectedState), Buffer.from(state))) throw new ApiError(400, "Google sign-in could not be verified. Please try again.");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callbackUrl(), grant_type: "authorization_code" }) });
  if (!tokenResponse.ok) throw new ApiError(401, "Google sign-in was not completed.");
  const token = await tokenResponse.json() as { id_token?: string };
  if (!token.id_token) throw new ApiError(401, "Google did not return an identity token.");
  const verified = await jwtVerify(token.id_token, googleJwks as never, { issuer: [googleIssuer, "accounts.google.com"], audience: clientId });
  if (verified.payload.nonce !== nonce) throw new ApiError(401, "Google sign-in could not be verified. Please try again.");
  const email = typeof verified.payload.email === "string" ? verified.payload.email.toLowerCase() : "";
  if (verified.payload.email_verified !== true || !email || typeof verified.payload.sub !== "string") throw new ApiError(401, "Your Google account could not be verified.");
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.active) throw new ApiError(403, "This Google account is not registered for a SkillPulse workspace.");
  if (user.googleSub && user.googleSub !== verified.payload.sub) throw new ApiError(403, "This Google account is not linked to this workspace user.");
  await db.user.update({ where: { id: user.id }, data: { googleSub: verified.payload.sub } });
  await createSession(user, "google");
  return user;
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get("skillpulse_session")?.value;
  if (token) await db.session.deleteMany({ where: { id: sessionHash(token) } });
  jar.delete("skillpulse_session");
}
function encryptionKey() {
  const key = process.env.FIELD_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new ApiError(503, "Contact encryption is not configured.");
  return Buffer.from(key, "hex");
}
export function encryptContact(value: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [nonce, cipher.getAuthTag(), encrypted].map(part => part.toString("base64")).join(".");
}
export function decryptContact(value: string | null) {
  if (!value) return "";
  const [nonce, tag, encrypted] = value.split(".").map(part => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}