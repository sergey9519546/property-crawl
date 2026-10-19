import { verifyScrapySignature, validateScrapyPayload, SUPPORTED_RECIPES } from "@server/ingest/scrapy-webhook";

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


  return Response.json(
    {
      success: true,
      count: validated.items.length,
      recipe: validated.recipe,
    },
    { status: 200, headers: responseHeaders }
  );
}
