import {
  verifyScrapySignature,
  validateScrapyPayload,
  ingestScrapyItems,
  SUPPORTED_RECIPES,
} from "@server/ingest/scrapy-webhook";
import { resolveLiveStorePath, mergeLiveRecords } from "@server/db/live-record-store";
import { servesListings } from "@server/sources/catalog";
import { validateListingForIngestion } from "@server/scrapers/validation";

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

  const db = require("@server/db/client");
  if (typeof db.verifyConnection === "function" && !db.postgresReachable && db.pool) {
    await db.verifyConnection().catch(() => {});
  }
  const isPostgres = Boolean(
    db.isPg || (typeof db.dataMode === "function" ? db.dataMode() === "postgres" : false)
  );

  const ingestResult = await ingestScrapyItems(validated.items, {
    sourceKey: validated.source || undefined,
    db,
    isPostgres,
    liveStorePath: resolveLiveStorePath(),
    mergeLiveRecordsImpl: mergeLiveRecords,
    servesListingsImpl: servesListings,
    validateListingImpl: validateListingForIngestion,
  });

  return Response.json(
    {
      ok: true,
      success: true,
      recipe: validated.recipe,
      spider: validated.spider || null,
      source: validated.source || null,
      count: validated.items.length,
      received: ingestResult.received,
      accepted: ingestResult.accepted,
      rejected: ingestResult.rejected,
      totalLive: ingestResult.totalLive,
      ...(ingestResult.isPostgres
        ? {
            postgresAccepted: ingestResult.postgresAccepted,
            postgresRejected: ingestResult.postgresRejected,
            postgresFailed: ingestResult.postgresFailed,
          }
        : {}),
    },
    { status: 200, headers: responseHeaders }
  );
}
