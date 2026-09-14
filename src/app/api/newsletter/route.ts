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
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "A valid email is required" }, { status: 400, headers: responseHeaders });
  }
  // Accept and acknowledge. Email delivery is wired separately.
  return Response.json({ ok: true, queued: true }, { status: 202, headers: responseHeaders });
}
