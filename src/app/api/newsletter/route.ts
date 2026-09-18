import { persistFormSubmission, sanitize } from "@/lib/form-submissions";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > 4096) {
    return Response.json({ error: "Request body too large" }, { status: 413, headers: responseHeaders });
  }
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: responseHeaders });
  }
  const email = sanitize(body.email, 320).toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "A valid email is required" }, { status: 400, headers: responseHeaders });
  }

  const result = await persistFormSubmission("newsletter", { email });
  return Response.json(
    {
      ok: true,
      queued: true,
      delivery: result.delivery,
      message: result.delivery === "forwarded"
        ? "Subscription accepted."
        : "Subscription saved. Operator email delivery is not configured yet.",
    },
    { status: 202, headers: responseHeaders }
  );
}
