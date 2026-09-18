import { persistFormSubmission, sanitize } from "@/lib/form-submissions";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > 8192) {
    return Response.json({ error: "Request body too large" }, { status: 413, headers: responseHeaders });
  }
  let body: { name?: unknown; email?: unknown; company?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: responseHeaders });
  }
  const name = sanitize(body.name, 200);
  const email = sanitize(body.email, 320);
  const company = sanitize(body.company, 200);
  const message = sanitize(body.message, 5000);
  if (!name || name.length > 200) {
    return Response.json({ error: "Name is required (max 200 characters)" }, { status: 400, headers: responseHeaders });
  }
  if (!email || email.length > 320 || !email.includes("@")) {
    return Response.json({ error: "A valid email is required" }, { status: 400, headers: responseHeaders });
  }
  if (!message || message.length > 5000) {
    return Response.json({ error: "Message is required (max 5000 characters)" }, { status: 400, headers: responseHeaders });
  }

  const result = await persistFormSubmission("contact", { name, email, company, message });
  return Response.json(
    {
      ok: true,
      queued: true,
      delivery: result.delivery,
      message: result.delivery === "forwarded"
        ? "Message accepted."
        : "Message saved for the operator. Outbound delivery is not configured yet.",
    },
    { status: 202, headers: responseHeaders }
  );
}
