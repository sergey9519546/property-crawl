import { checkFormRateLimit } from "@/lib/form-rate-limit";
import { accountsApi } from "@/lib/member-account";
import { rateLimitKey } from "@/lib/client-ip";
import { workspaceMutationAllowed } from "@/lib/workspace-session";
import { appOrigin } from "@/lib/app-origin";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

type MailDeliveryResult = {
  delivery: "sent" | "local" | "unavailable";
  sent: boolean;
  reason?: string;
  id?: string | null;
};

function isValidFromAddress(value: string): boolean {
  const from = value.trim();
  if (!from || /[\r\n]/.test(from) || from.length > 320) return false;
  if (EMAIL_PATTERN.test(from)) return true;
  const match = from.match(/^([^<>]+?)\s*<([^<>\s]+)>$/);
  if (!match) return false;
  return Boolean(match[1].trim()) && EMAIL_PATTERN.test(match[2].trim());
}

async function sendLoginMailEdge({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}): Promise<MailDeliveryResult> {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM || "").trim();
  if (!apiKey || !isValidFromAddress(from)) {
    return { delivery: "unavailable", sent: false, reason: "not-configured" };
  }
  const safeSubject = subject.replace(/\r|\n/g, " ").trim().slice(0, 200);
  const safeText = text.slice(0, 20_000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: safeSubject,
        text: safeText,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return { delivery: "unavailable", sent: false, reason: `http-${response.status}` };
    }
    const body = (await response.json().catch(() => ({}))) as { id?: string | null };
    return { delivery: "sent", sent: true, id: body.id || null };
  } catch {
    return { delivery: "unavailable", sent: false, reason: "request-failed" };
  }
}

async function deliverLoginMail(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<MailDeliveryResult> {
  if (process.env.NEXT_RUNTIME === "edge") {
    return sendLoginMailEdge(params);
  }
  const { sendOutboundMail } = require("@server/delivery/outbound-mail") as typeof import("@server/delivery/outbound-mail");
  const result = await sendOutboundMail({
    to: params.to,
    kind: "login-link",
    subject: params.subject,
    html: null,
    text: params.text,
  });
  return result as MailDeliveryResult;
}

export async function POST(request: Request) {
  if (!workspaceMutationAllowed(request)) return Response.json({ error: "Same-origin request required" }, { status: 403, headers });
  let body: { email?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400, headers }); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "A valid email is required" }, { status: 400, headers });
  }
  const perEmail = checkFormRateLimit("account-login", { key: email, maxPerWindow: 5 });
  const perIp = checkFormRateLimit("account-login", { key: rateLimitKey("account-login", request, "ip"), maxPerWindow: 20 });
  const global = checkFormRateLimit("account-login", { maxPerWindow: 200 });
  if (!perEmail.allowed || !perIp.allowed || !global.allowed) {
    const retry = Math.max(perEmail.retryAfterSeconds, perIp.retryAfterSeconds, global.retryAfterSeconds);
    return Response.json({ error: "Too many sign-in requests. Retry later." }, { status: 429, headers: { ...headers, "Retry-After": String(retry) } });
  }
  const origin = appOrigin(request);
  if (!origin) return Response.json({ error: "Sign-in links need PUBLIC_APP_ORIGIN on this deployment" }, { status: 503, headers });
  const issued = await accountsApi<{ token?: string; error?: string }>("/login-token", { method: "POST", body: { email } });
  if (!issued.ok || !issued.data.token) {
    return Response.json({ error: issued.data.error || "Sign-in is unavailable right now" }, { status: issued.status === 400 ? 400 : 503, headers });
  }
  const link = `${origin}/account/verify?token=${encodeURIComponent(issued.data.token)}`;
  const mail = await deliverLoginMail({
    to: email,
    subject: "Your PerfectProperty sign-in link",
    text: `Sign in to PerfectProperty:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
  });
  const resendTransportFailure = Boolean(mail.reason && (mail.reason.startsWith("http-") || mail.reason === "request-failed"));
  if (mail.delivery === "unavailable" || resendTransportFailure || (process.env.NODE_ENV === "production" && mail.delivery === "local")) {
    return Response.json({ error: "The sign-in email could not be sent" }, { status: 503, headers });
  }
  return Response.json({
    sent: true,
    delivery: mail.delivery,
    message: mail.delivery === "local"
      ? "Email delivery is not configured here, so the sign-in link was written to the server's local mail outbox."
      : "Check your inbox for a sign-in link. It expires in 15 minutes.",
  }, { status: 202, headers });
}
