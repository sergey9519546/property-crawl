import { verifyScrapySignature, validateScrapyPayload, SUPPORTED_RECIPES } from "@server/ingest/scrapy-webhook";
import { resolveLiveStorePath, mergeLiveRecords } from "@server/db/live-record-store";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  return Response.json(
    {
      service: "scrapy-ingest",
      status: "active",
      configured: Boolean(process.env.SCRAPY_INGEST_SECRET),
      supportedRecipes: SUPPORTED_RECIPES,
    },
    { headers: responseHeaders }
  );
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json(
      { error: "Payload exceeds maximum allowed size (2 MB)." },
      { status: 413, headers: responseHeaders }
    );
  }

  const signature = request.headers.get("x-signature") || "";

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json(
      { error: "Could not read request body." },
      { status: 400, headers: responseHeaders }
    );
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return Response.json(
      { error: "Payload exceeds maximum allowed size (2 MB)." },
      { status: 413, headers: responseHeaders }
    );
  }

  const auth = verifyScrapySignature(rawBody, signature);
  if (!auth.valid) {
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers: responseHeaders }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json(
      { error: "Invalid JSON payload." },
      { status: 400, headers: responseHeaders }
    );
  }

  const validated = validateScrapyPayload(payload);
  if (!validated.valid || !validated.items) {
    return Response.json(
      { error: validated.error || "Invalid payload." },
      { status: 400, headers: responseHeaders }
    );
  }

  let accepted = 0;
  if (validated.items.length > 0) {
    try {
      const merged = mergeLiveRecords(resolveLiveStorePath(), validated.items);
      accepted = merged.accepted || 0;
    } catch (err) {
      console.error("[Scrapy Ingest] Live record store merge failed:", (err as Error)?.message);
    }
  }

  return Response.json(
    {
      success: true,
      count: validated.items.length,
      accepted,
      recipe: validated.recipe,
    },
    { status: 200, headers: responseHeaders }
  );
}
