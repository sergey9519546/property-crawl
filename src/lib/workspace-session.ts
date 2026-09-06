import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const WORKSPACE_SESSION_COOKIE = "pp_operator_session";
export const WORKSPACE_SESSION_SECONDS = 8 * 60 * 60;

type WorkspaceSession = { authenticated: boolean; expiresAt: string | null };

function configuredOperatorCredential(env: NodeJS.ProcessEnv = process.env) {
  return String(env.SCRAPER_ADMIN_TOKEN || "").trim();
}

function signingKey(env: NodeJS.ProcessEnv = process.env) {
  const credential = configuredOperatorCredential(env);
  if (!credential) return null;
  const sessionSecret = String(env.WORKSPACE_SESSION_SECRET || "").trim();
  return createHash("sha256")
    .update("perfectproperty/workspace-session/v1\0")
    .update(sessionSecret || credential)
    .update("\0")
    .update(credential)
    .digest();
}

function safeEqual(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function sign(payload: string, env: NodeJS.ProcessEnv = process.env) {
  const key = signingKey(env);
  return key ? createHmac("sha256", key).update(payload).digest("base64url") : null;
}

function requestCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

export function workspaceSessionConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const credential = configuredOperatorCredential(env);
  return { configured: Boolean(credential), credential };
}

export function verifyOperatorCredential(candidate: unknown, env: NodeJS.ProcessEnv = process.env) {
  const configured = configuredOperatorCredential(env);
  return configured.length > 0 && typeof candidate === "string" && candidate.length <= 512 && safeEqual(candidate.trim(), configured);
}

export function issueWorkspaceSession(now = Date.now(), env: NodeJS.ProcessEnv = process.env) {
  if (!signingKey(env)) return null;
  const expiresAtMs = now + WORKSPACE_SESSION_SECONDS * 1000;
  const payload = `v1.${Math.floor(expiresAtMs / 1000)}.${randomBytes(18).toString("base64url")}`;
  const signature = sign(payload, env);
  if (!signature) return null;
  return { value: `${payload}.${signature}`, expiresAt: new Date(expiresAtMs).toISOString() };
}

export function readWorkspaceSession(request: Request, now = Date.now(), env: NodeJS.ProcessEnv = process.env): WorkspaceSession {
  const value = requestCookie(request, WORKSPACE_SESSION_COOKIE);
  if (!value) return { authenticated: false, expiresAt: null };
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return { authenticated: false, expiresAt: null };
  const payload = parts.slice(0, 3).join(".");
  const expected = sign(payload, env);
  if (!expected || !safeEqual(parts[3], expected)) return { authenticated: false, expiresAt: null };
  const expiresAtMs = Number(parts[1]) * 1000;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return { authenticated: false, expiresAt: null };
  return { authenticated: true, expiresAt: new Date(expiresAtMs).toISOString() };
}

export function workspaceMutationAllowed(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

export function serializeWorkspaceSession(value: string, request: Request) {
  const secure = process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
  return `${WORKSPACE_SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${WORKSPACE_SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearWorkspaceSession(request: Request) {
  const secure = process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
  return `${WORKSPACE_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

