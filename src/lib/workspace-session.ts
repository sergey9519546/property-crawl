import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const WORKSPACE_SESSION_COOKIE = "pp_operator_session";
export const WORKSPACE_SESSION_SECONDS = 8 * 60 * 60;

/**
 * Multi-Tenant Role-Based Access Control (RBAC) definitions.
 * Canonical Roles:
 * - operator: Highest privilege (full write/unlock/export/scrapers run/purge).
 * - analyst:  Read listings, save hunts, view documents, run research export.
 * - viewer:   Read-only (listings, public source radar; cannot trigger runs or mutate cases).
 */
export type Role = "operator" | "analyst" | "viewer";

export type Permission =
  | "canRunScrapers"
  | "canReviewDocuments"
  | "canExportDossier"
  | "canManageHunts"
  | "canViewWorkspace";

export const ROLES: Record<string, Role> = Object.freeze({
  OPERATOR: "operator",
  ANALYST: "analyst",
  VIEWER: "viewer",
});

export const CANONICAL_ROLES: readonly Role[] = Object.freeze(["operator", "analyst", "viewer"] as const);

export const PERMISSIONS: readonly Permission[] = Object.freeze([
  "canRunScrapers",
  "canReviewDocuments",
  "canExportDossier",
  "canManageHunts",
  "canViewWorkspace",
] as const);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = Object.freeze({
  operator: Object.freeze<readonly Permission[]>([
    "canRunScrapers",
    "canReviewDocuments",
    "canExportDossier",
    "canManageHunts",
    "canViewWorkspace",
  ] as const),
  analyst: Object.freeze<readonly Permission[]>([
    "canReviewDocuments",
    "canExportDossier",
    "canManageHunts",
    "canViewWorkspace",
  ] as const),
  viewer: Object.freeze<readonly Permission[]>([
    "canViewWorkspace",
  ] as const),
});

export const ROLE_HIERARCHY: Record<Role, number> = Object.freeze({
  operator: 3,
  analyst: 2,
  viewer: 1,
});

/**
 * Permission check enforcing role boundaries.
 */
export function hasPermission(
  role: Role | string | null | undefined,
  permission: Permission | string,
  options: { authenticated?: boolean } = {}
): boolean {
  if (!role || typeof role !== "string") return false;
  const normalizedRole = role.trim().toLowerCase() as Role;
  if (!CANONICAL_ROLES.includes(normalizedRole)) return false;

  // Viewer role has NO mutation permissions (canRunScrapers, canReviewDocuments, canExportDossier, canManageHunts).
  // Viewer can only view workspace if explicitly authenticated.
  if (normalizedRole === "viewer") {
    if (permission === "canViewWorkspace") {
      return options.authenticated !== false;
    }
    return false;
  }

  const perms = ROLE_PERMISSIONS[normalizedRole];
  return Boolean(perms && perms.includes(permission as Permission));
}

/**
 * Extracts or resolves the role from an incoming token or session representation.
 * Backward compatible: tokens without an explicit role default to 'operator'.
 */
export function extractRoleFromToken(
  token: unknown,
  options: { defaultRole?: Role; allowNull?: boolean } = {}
): Role | null {
  const defaultRole: Role = options.defaultRole || "operator";
  if (!token) {
    return options.allowNull ? null : defaultRole;
  }

  if (typeof token === "object" && token !== null && "role" in token) {
    const candidate = String((token as { role?: unknown }).role || "").trim().toLowerCase() as Role;
    if (CANONICAL_ROLES.includes(candidate)) return candidate;
    return defaultRole;
  }

  if (typeof token === "string") {
    const trimmed = token.trim();
    if (!trimmed) {
      return options.allowNull ? null : defaultRole;
    }

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.role && typeof parsed.role === "string") {
          const candidate = parsed.role.trim().toLowerCase() as Role;
          if (CANONICAL_ROLES.includes(candidate)) return candidate;
        }
      } catch {}
    }

    const prefixMatch = trimmed.match(/^(operator|analyst|viewer)[:._/-]/i);
    if (prefixMatch) {
      return prefixMatch[1].toLowerCase() as Role;
    }

    const queryMatch = trimmed.match(/(?:^|[&?])role=(operator|analyst|viewer)(?:[&;]|$)/i);
    if (queryMatch) {
      return queryMatch[1].toLowerCase() as Role;
    }

    const v2Match = trimmed.match(/^v2\.\d+\.(operator|analyst|viewer)\./i);
    if (v2Match) {
      return v2Match[1].toLowerCase() as Role;
    }

    return defaultRole;
  }

  return defaultRole;
}

export function isAtLeastRole(userRole: string | null | undefined, requiredRole: Role): boolean {
  const userLevel = ROLE_HIERARCHY[String(userRole || "").trim().toLowerCase() as Role] || 0;
  const reqLevel = ROLE_HIERARCHY[requiredRole] || 0;
  return userLevel >= reqLevel && reqLevel > 0;
}

export type WorkspaceSession = {
  authenticated: boolean;
  expiresAt: string | null;
  role: Role | null;
};

function configuredOperatorCredential(env: NodeJS.ProcessEnv = process.env) {
  return String(env.SCRAPER_ADMIN_TOKEN || env.PROPERTY_OPERATOR_SECRET || "").trim();
}

function signingKey(env: NodeJS.ProcessEnv = process.env) {
  const credential = configuredOperatorCredential(env);
  if (!credential) return null;
  const sessionSecret = String(env.WORKSPACE_SESSION_SECRET || "").trim();
  // WORKSPACE_SESSION_EPOCH lets the operator revoke outstanding cookies
  // without rotating the unlock password (bump the epoch and redeploy).
  const sessionEpoch = String(env.WORKSPACE_SESSION_EPOCH || "1").trim() || "1";
  return createHash("sha256")
    .update("perfectproperty/workspace-session/v1\0")
    .update(sessionSecret || credential)
    .update("\0")
    .update(credential)
    .update("\0")
    .update(sessionEpoch)
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

export function issueWorkspaceSession(
  now = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
  role: Role = "operator"
) {
  if (!signingKey(env)) return null;
  const expiresAtMs = now + WORKSPACE_SESSION_SECONDS * 1000;
  const canonicalRole = CANONICAL_ROLES.includes(role) ? role : "operator";
  // v2 payload embeds the role while remaining compact and signed
  const payload = `v2.${Math.floor(expiresAtMs / 1000)}.${canonicalRole}.${randomBytes(18).toString("base64url")}`;
  const signature = sign(payload, env);
  if (!signature) return null;
  return { value: `${payload}.${signature}`, expiresAt: new Date(expiresAtMs).toISOString(), role: canonicalRole };
}

export function readWorkspaceSession(
  request: Request,
  now = Date.now(),
  env: NodeJS.ProcessEnv = process.env
): WorkspaceSession {
  const value = requestCookie(request, WORKSPACE_SESSION_COOKIE);
  if (!value) return { authenticated: false, expiresAt: null, role: null };
  const parts = value.split(".");

  // Legacy v1 session: v1.<expiresAt>.<random>.<signature>
  // Missing role defaults to operator for 100% backward compatibility
  if (parts.length === 4 && parts[0] === "v1") {
    const payload = parts.slice(0, 3).join(".");
    const expected = sign(payload, env);
    if (!expected || !safeEqual(parts[3], expected)) return { authenticated: false, expiresAt: null, role: null };
    const expiresAtMs = Number(parts[1]) * 1000;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return { authenticated: false, expiresAt: null, role: null };
    return { authenticated: true, expiresAt: new Date(expiresAtMs).toISOString(), role: "operator" };
  }

  // v2 session with explicit role: v2.<expiresAt>.<role>.<random>.<signature>
  if (parts.length === 5 && parts[0] === "v2") {
    const payload = parts.slice(0, 4).join(".");
    const expected = sign(payload, env);
    if (!expected || !safeEqual(parts[4], expected)) return { authenticated: false, expiresAt: null, role: null };
    const expiresAtMs = Number(parts[1]) * 1000;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return { authenticated: false, expiresAt: null, role: null };
    const candidateRole = parts[2] as Role;
    const role: Role = CANONICAL_ROLES.includes(candidateRole) ? candidateRole : "operator";
    return { authenticated: true, expiresAt: new Date(expiresAtMs).toISOString(), role };
  }

  return { authenticated: false, expiresAt: null, role: null };
}

function normalizeLoopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "127.0.0.1" || host === "::1" || host === "0:0:0:0:0:0:0:1" || host === "0.0.0.0" || host === "[::]") {
    return "localhost";
  }
  return host;
}

function sameBrowserOrigin(origin: string, requestUrl: string) {
  try {
    const a = new URL(origin);
    const b = new URL(requestUrl);
    if (normalizeLoopbackHost(a.hostname) !== normalizeLoopbackHost(b.hostname)) return false;
    const portA = a.port || (a.protocol === "https:" ? "443" : "80");
    const portB = b.port || (b.protocol === "https:" ? "443" : "80");
    return portA === portB && a.protocol === b.protocol;
  } catch {
    return false;
  }
}

function trustedProxyEnabled(env: NodeJS.ProcessEnv = process.env) {
  const n = Number(env.TRUSTED_PROXY_COUNT || "0");
  return Number.isFinite(n) && n > 0;
}

export function workspaceMutationAllowed(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) {
    return request.headers.get("x-workspace-request") === "1";
  }
  if (sameBrowserOrigin(origin, request.url)) return true;
  const publicApp = String(process.env.PUBLIC_APP_ORIGIN || "").trim();
  if (publicApp && (origin === publicApp || sameBrowserOrigin(origin, publicApp))) return true;
  // Forwarded Host/Proto are client-influenced unless a reverse proxy is
  // explicitly trusted. Never mint same-origin from untrusted XFH.
  if (!trustedProxyEnabled(process.env)) return false;
  try {
    const requestOrigin = new URL(request.url).origin;
    const forwardedHost =
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
      request.headers.get("host")?.split(",")[0]?.trim();
    const forwardedProto =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      (requestOrigin.startsWith("https:") ? "https" : "http");
    if (forwardedHost) {
      const publicOrigin = `${forwardedProto}://${forwardedHost}`;
      if (origin === publicOrigin || sameBrowserOrigin(origin, publicOrigin)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function cookieIsSecure(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https") return true;
  if (forwarded === "http" && trustedProxyEnabled(process.env)) return false;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production" && !process.env.WORKSPACE_COOKIE_INSECURE;
  }
}

export function serializeWorkspaceSession(value: string, request: Request) {
  const secure = cookieIsSecure(request);
  return `${WORKSPACE_SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${WORKSPACE_SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearWorkspaceSession(request: Request) {
  const secure = cookieIsSecure(request);
  return `${WORKSPACE_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}
