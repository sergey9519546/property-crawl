import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookieIsSecure, workspaceSessionConfiguration } from "@/lib/workspace-session";

// Paid-member sessions. Separate from the operator cookie: a member session
// names one account and never unlocks operator tools. Lax (not Strict) so a
// listing link clicked in an alert email still arrives signed in.
export const MEMBER_SESSION_COOKIE = "pp_member_session";
export const MEMBER_SESSION_SECONDS = 30 * 24 * 60 * 60;
const ACCOUNT_ID = /^acct_[a-f0-9]{24}$/;

export type MemberAccount = {
  id: string;
  email: string;
  stripeCustomerId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  entitled: boolean;
};

function signingKey(env: NodeJS.ProcessEnv = process.env) {
  const credential = workspaceSessionConfiguration(env).credential;
  if (!credential) return null;
  return createHash("sha256")
    .update("perfectproperty/member-session/v1\0")
    .update(String(env.WORKSPACE_SESSION_SECRET || "").trim() || credential)
    .update("\0")
    .update(String(env.MEMBER_SESSION_EPOCH || "1"))
    .digest();
}

function sign(payload: string, env?: NodeJS.ProcessEnv) {
  const key = signingKey(env);
  return key ? createHmac("sha256", key).update(payload).digest("base64url") : null;
}

export function issueMemberSession(accountId: string, now = Date.now(), env?: NodeJS.ProcessEnv) {
  if (!ACCOUNT_ID.test(accountId)) return null;
  const payload = `m1.${Math.floor(now / 1000) + MEMBER_SESSION_SECONDS}.${accountId}`;
  const signature = sign(payload, env);
  return signature ? `${payload}.${signature}` : null;
}

export function readMemberSession(request: Request, now = Date.now(), env?: NodeJS.ProcessEnv): string | null {
  const header = request.headers.get("cookie") || "";
  const raw = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${MEMBER_SESSION_COOKIE}=`));
  const parts = raw ? raw.slice(MEMBER_SESSION_COOKIE.length + 1).split(".") : [];
  if (parts.length !== 4 || parts[0] !== "m1" || !ACCOUNT_ID.test(parts[2])) return null;
  const expected = sign(parts.slice(0, 3).join("."), env);
  if (!expected) return null;
  const a = createHash("sha256").update(parts[3]).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) return null;
  return Number(parts[1]) * 1000 > now ? parts[2] : null;
}

export function serializeMemberSession(value: string, request: Request) {
  return `${MEMBER_SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MEMBER_SESSION_SECONDS}${cookieIsSecure(request) ? "; Secure" : ""}`;
}

export function clearMemberSession(request: Request) {
  return `${MEMBER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieIsSecure(request) ? "; Secure" : ""}`;
}

// Server-to-server calls to the API's /api/accounts routes (operator token).
export async function accountsApi<T = { account?: MemberAccount; error?: string }>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const { credential, configured } = workspaceSessionConfiguration();
  if (!configured) return { ok: false, status: 503, data: { error: "Accounts are not configured" } as T };
  const base = (process.env.PROPERTY_API_URL || "http://localhost:3000").replace(/\/$/, "");
  try {
    const response = await fetch(`${base}/api/accounts${path}`, {
      method: init.method || "GET",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json", Accept: "application/json" },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const data = (await response.json().catch(() => ({}))) as T;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 503, data: { error: "Account service is unreachable" } as T };
  }
}

export async function currentMember(request: Request): Promise<MemberAccount | null> {
  const accountId = readMemberSession(request);
  if (!accountId) return null;
  const result = await accountsApi(`/${accountId}`);
  return result.ok ? result.data.account ?? null : null;
}
