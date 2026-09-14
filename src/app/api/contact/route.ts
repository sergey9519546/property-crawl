const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > 8192) {
    return Response.json({ error: "Request body too large" }, { status: 413, headers: responseHeaders });
  }
  let body: { name?: unknown; email?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: responseHeaders });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!name || name.length > 200) {
    return Response.json({ error: "Name is required (max 200 characters)" }, { status: 400, headers: responseHeaders });
  }
  if (!email || email.length > 320 || !email.includes("@")) {
    return Response.json({ error: "A valid email is required" }, { status: 400, headers: responseHeaders });
  }
  if (!message || message.length > 5000) {
    return Response.json({ error: "Message is required (max 5000 characters)" }, { status: 400, headers: responseHeaders });
  }
  // Accept and acknowledge. Email delivery is wired separately.
  return Response.json({ ok: true, queued: true }, { status: 202, headers: responseHeaders });
}
