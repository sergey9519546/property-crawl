import { createHash, timingSafeEqual } from "node:crypto";
import { workspaceUnlockBucket, workspaceUnlockLimiter } from "@/lib/workspace-unlock-limiter";
import { currentMember } from "@/lib/member-account";
import {
  CANONICAL_ROLES,
  clearWorkspaceSession,
  isAtLeastRole,
  issueWorkspaceSession,
  permissionsForRole,
  readWorkspaceSession,
  serializeWorkspaceSession,
  verifyOperatorCredential,
  workspaceMutationAllowed,
  workspaceSessionConfiguration,
  type Role,
} from "@/lib/workspace-session";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function safeSecretEqual(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function parseExplicitRole(candidate: unknown): { present: boolean; valid: boolean; role: Role | null } {
  if (candidate === undefined || candidate === null) {
    return { present: false, valid: true, role: null };
  }
  if (typeof candidate !== "string") {
    return { present: true, valid: false, role: null };
  }
  const trimmed = candidate.trim().toLowerCase();
  if (!trimmed) {
    return { present: false, valid: true, role: null };
  }
  if (!CANONICAL_ROLES.includes(trimmed as Role)) {
    return { present: true, valid: false, role: null };
  }
  return { present: true, valid: true, role: trimmed as Role };
}

function matchSecretRole(secret: string, env: NodeJS.ProcessEnv = process.env): Role | null {
  if (!secret || secret.length > 512) return null;
  if (verifyOperatorCredential(secret, env)) return "operator";
  const analystSecret = String(env.PROPERTY_ANALYST_SECRET || "").trim();
  if (analystSecret && safeSecretEqual(secret, analystSecret)) return "analyst";
  const viewerSecret = String(env.PROPERTY_VIEWER_SECRET || "").trim();
  if (viewerSecret && safeSecretEqual(secret, viewerSecret)) return "viewer";
  return null;
}

type CredentialResolution =
  | { ok: true; role: Role }
  | { ok: false; status: 400 | 401 | 403; error: string };

function resolveWorkspaceUnlockRole(
  body: { credential?: unknown; role?: unknown } | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CredentialResolution {
  const bodyRoleCheck = parseExplicitRole(body?.role);
  if (!bodyRoleCheck.valid) {
    return { ok: false, status: 400, error: "Invalid workspace role" };
  }

  const rawCredential = body?.credential;
  let matchedRole: Role | null = null;
  let embeddedRole: Role | null = null;

  if (typeof rawCredential === "string") {
    const trimmed = rawCredential.trim();
    if (trimmed.length > 0 && trimmed.length <= 512) {
      matchedRole = matchSecretRole(trimmed, env);

      if (!matchedRole && trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          const parsedRole = parseExplicitRole(parsed?.role);
          if (!parsedRole.valid) {
            return { ok: false, status: 400, error: "Invalid workspace role" };
          }
          const innerSecret = parsed?.credential ?? parsed?.token ?? parsed?.secret;
          if (typeof innerSecret === "string" && innerSecret.trim().length > 0) {
            matchedRole = matchSecretRole(innerSecret.trim(), env);
            embeddedRole = parsedRole.role;
          }
        } catch {
          // Malformed JSON fails closed as an invalid credential below.
        }
      }

      if (!matchedRole) {
        const prefixMatch = trimmed.match(/^(operator|analyst|viewer)[:._/-](.+)$/i);
        if (prefixMatch) {
          const innerSecret = prefixMatch[2].trim();
          const prefixMatchedRole = matchSecretRole(innerSecret, env);
          if (prefixMatchedRole) {
            matchedRole = prefixMatchedRole;
            embeddedRole = prefixMatch[1].toLowerCase() as Role;
          }
        }
      }
    }
  } else if (rawCredential && typeof rawCredential === "object" && !Array.isArray(rawCredential)) {
    const record = rawCredential as Record<string, unknown>;
    const parsedRole = parseExplicitRole(record.role);
    if (!parsedRole.valid) {
      return { ok: false, status: 400, error: "Invalid workspace role" };
    }
    const innerSecret = record.credential ?? record.token ?? record.secret;
    if (typeof innerSecret === "string" && innerSecret.trim().length > 0) {
      matchedRole = matchSecretRole(innerSecret.trim(), env);
      embeddedRole = parsedRole.role;
    }
  }

  if (!matchedRole) {
    return { ok: false, status: 401, error: "Workspace credential was not accepted" };
  }

  if (embeddedRole && bodyRoleCheck.role && embeddedRole !== bodyRoleCheck.role) {
    return { ok: false, status: 403, error: "Requested workspace role conflicts with credential role" };
  }

  const targetRole: Role = bodyRoleCheck.role || embeddedRole || matchedRole;
  if (!isAtLeastRole(matchedRole, targetRole)) {
    return { ok: false, status: 403, error: "Credential is not authorized for the requested workspace role" };
  }

  return { ok: true, role: targetRole };
}

export async function GET(request: Request) {
  const config = workspaceSessionConfiguration();
  // Do not disclose configured=true/false as a cheap oracle without session;
  // still report authentication state for the workspace shell.
  const member = config.configured ? await currentMember(request) : null;
  const session = readWorkspaceSession(request);
  return Response.json({
    configured: config.configured,
    ...session,
    permissions: session.authenticated ? permissionsForRole(session.role) : [],
    member: member && { email: member.email, entitled: member.entitled, billingTier: member.billingTier ?? null },
  }, { headers: responseHeaders });
}

export async function POST(request: Request) {
  if (!workspaceMutationAllowed(request)) return Response.json({ error: "Same-origin workspace request required" }, { status: 403, headers: responseHeaders });
  if (Number(request.headers.get("content-length")) > 8192) return Response.json({ error: "Request body too large" }, { status: 413, headers: responseHeaders });
  const config = workspaceSessionConfiguration();
  if (!config.configured) return Response.json({ error: "Set SCRAPER_ADMIN_TOKEN on both application processes before unlocking the workspace" }, { status: 503, headers: responseHeaders });
  const bucket = workspaceUnlockBucket(request);
  let body: { credential?: unknown; role?: unknown };
  try { body = await request.json(); }
  catch {
    const decision = workspaceUnlockLimiter.check(bucket);
    if (!decision.allowed) return Response.json({ error: "Too many unlock attempts. Retry later." }, { status: 429, headers: { ...responseHeaders, "Retry-After": String(decision.retryAfterSeconds) } });
    workspaceUnlockLimiter.recordFailure(bucket);
    return Response.json({ error: "A workspace credential is required" }, { status: 400, headers: responseHeaders });
  }
  const decision = workspaceUnlockLimiter.check(bucket);
  if (!decision.allowed) return Response.json({ error: "Too many unlock attempts. Retry later." }, { status: 429, headers: { ...responseHeaders, "Retry-After": String(decision.retryAfterSeconds) } });

  const resolved = resolveWorkspaceUnlockRole(body, process.env);
  if (!resolved.ok) {
    workspaceUnlockLimiter.recordFailure(bucket);
    return Response.json({ error: resolved.error }, { status: resolved.status, headers: responseHeaders });
  }

  workspaceUnlockLimiter.reset(bucket);
  const session = issueWorkspaceSession(Date.now(), process.env, resolved.role);
  if (!session) return Response.json({ error: "Workspace session could not be created" }, { status: 503, headers: responseHeaders });
  return Response.json(
    { authenticated: true, configured: true, role: session.role, permissions: permissionsForRole(session.role), expiresAt: session.expiresAt },
    { headers: { ...responseHeaders, "Set-Cookie": serializeWorkspaceSession(session.value, request) } },
  );
}

export async function DELETE(request: Request) {
  if (!workspaceMutationAllowed(request)) return Response.json({ error: "Same-origin workspace request required" }, { status: 403, headers: responseHeaders });
  return Response.json(
    { authenticated: false, configured: workspaceSessionConfiguration().configured, role: null, permissions: [], expiresAt: null },
    { headers: { ...responseHeaders, "Set-Cookie": clearWorkspaceSession(request) } },
  );
}
