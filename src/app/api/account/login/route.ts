import { checkFormRateLimit } from "@/lib/form-rate-limit";
import { accountsApi } from "@/lib/member-account";
import { workspaceMutationAllowed } from "@/lib/workspace-session";
import { sendOutboundMail } from "@server/delivery/outbound-mail";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

// The link must point at our own site. In production that is PUBLIC_APP_ORIGIN;
// the request's Host header is attacker-controlled and would let someone mail a
// victim a valid sign-in token on a hostile domain.
function appOrigin(request: Request) {
  const configured = String(process.env.PUBLIC_APP_ORIGIN || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? null : new URL(request.url).origin;
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
  const global = checkFormRateLimit("account-login", { maxPerWindow: 200 });
  if (!perEmail.allowed || !global.allowed) {
    const retry = Math.max(perEmail.retryAfterSeconds, global.retryAfterSeconds);
    return Response.json({ error: "Too many sign-in requests. Retry later." }, { status: 429, headers: { ...headers, "Retry-After": String(retry) } });
  }
  const origin = appOrigin(request);
  if (!origin) return Response.json({ error: "Sign-in links need PUBLIC_APP_ORIGIN on this deployment" }, { status: 503, headers });
  const issued = await accountsApi<{ token?: string; error?: string }>("/login-token", { method: "POST", body: { email } });
  if (!issued.ok || !issued.data.token) {
    return Response.json({ error: issued.data.error || "Sign-in is unavailable right now" }, { status: issued.status === 400 ? 400 : 503, headers });
  }
  const link = `${origin}/account/verify?token=${encodeURIComponent(issued.data.token)}`;
  const mail = await sendOutboundMail({
    to: email,
    kind: "login-link",
    subject: "Your PerfectProperty sign-in link",
    html: null,
    text: `Sign in to PerfectProperty:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
  });
  if (mail.delivery === "unavailable") return Response.json({ error: "The sign-in email could not be sent" }, { status: 503, headers });
  return Response.json({
    sent: true,
    delivery: mail.delivery,
    message: mail.delivery === "local"
      ? "Email delivery is not configured here, so the sign-in link was written to the server's local mail outbox."
      : "Check your inbox for a sign-in link. It expires in 15 minutes.",
  }, { status: 202, headers });
}
