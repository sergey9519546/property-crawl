import { proxyPropertyApi } from "@/lib/property-api";
import { proxyMemberPropertyApi, proxyPrivatePropertyApi } from "@/lib/workspace-proxy";
import { currentMember } from "@/lib/member-account";
import { hasPermission, readWorkspaceSession, workspaceSessionConfiguration } from "@/lib/workspace-session";
import { buildDecisionPacket, formatDecisionPacketMarkdown } from "@server/export/decision-packet";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/listings\/(.+?)\/(?:packet|decision-packet)$/);
  if (!match || !match[1]) {
    return Response.json({ error: "Invalid listing endpoint format" }, { status: 400 });
  }

  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return Response.json({ error: "Invalid listing identifier encoding" }, { status: 400 });
  }

  if (id.length > 256 || /[\/\\\u0000-\u001f\u007f]/.test(id)) {
    return Response.json({ error: "Invalid listing identifier" }, { status: 400 });
  }

  const session = readWorkspaceSession(request);
  const configuration = workspaceSessionConfiguration();

  // Authorized operator/analyst sessions proxy to the Node API with server
  // credentials; read-only viewers and anonymous callers stay on the public
  // read-only fallback below without operator token privileges.
  if (session.authenticated && hasPermission(session.role, "canExportDossier") && configuration.configured) {
    return proxyPropertyApi(request, { operatorToken: configuration.credential });
  }

  const remoteBase = process.env.PROPERTY_API_URL ? process.env.PROPERTY_API_URL.replace(/\/$/, "") : null;
  const base = remoteBase || "http://localhost:3000";
  const isEdgeRuntime = process.env.NEXT_RUNTIME === "edge";
  let listing: any = null;
  try {
    const res = await fetch(`${base}/api/listings/${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === "object" && !("error" in data)) {
        listing = data;
      }
    }
  } catch {
    // API down or network issue; fall through to local db query when not in edge runtime
  }

  if (!listing && !isEdgeRuntime) {
    try {
      const db = require("@server/db/client");
      listing = await db.getListingById(id);
    } catch {
      // Ignore
    }
  }

  if (!listing) {
    return Response.json({ error: "Listing not found", id }, { status: 404 });
  }

  const member = session.authenticated ? null : await currentMember(request).catch(() => null);
  const isEntitledCaller = session.authenticated || Boolean(member?.entitled);
  if (isEntitledCaller && !Array.isArray(listing.observations) && !isEdgeRuntime) {
    try {
      const db = require("@server/db/client");
      if (typeof db.getListingObservations === "function" && listing.id) {
        const observations = await db.getListingObservations(listing.id);
        if (Array.isArray(observations) && observations.length > 0) {
          listing = { ...listing, observations };
        }
      }
    } catch {
      // Ignore observation enrichment failure on public read path
    }
  }

  const parseNum = (val: string | null): number | null => {
    if (val === null || val === undefined || val === "") return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  };

  const operatorInput: Record<string, any> = {};

  const disposition = url.searchParams.get("disposition");
  if (disposition && disposition.trim()) {
    operatorInput.disposition = disposition.trim();
  }

  const mao = parseNum(url.searchParams.get("maxAllowableOffer"));
  if (mao !== null) operatorInput.maxAllowableOffer = mao;

  const rehab = parseNum(url.searchParams.get("rehabBudget"));
  if (rehab !== null) operatorInput.rehabBudget = rehab;

  const targetMargin = parseNum(url.searchParams.get("targetMargin"));
  if (targetMargin !== null) operatorInput.targetMargin = targetMargin;

  const canSetAttribution = session.authenticated && hasPermission(session.role, "canExportDossier");
  const operatorNotes = canSetAttribution ? url.searchParams.get("operatorNotes") : null;
  if (operatorNotes && operatorNotes.trim()) {
    operatorInput.operatorNotes = operatorNotes.trim();
  }

  const operatorId = canSetAttribution ? url.searchParams.get("operatorId") : null;
  if (operatorId && operatorId.trim()) {
    operatorInput.operatorId = operatorId.trim();
  } else if (session.authenticated) {
    operatorInput.operatorId = session.role;
  }

  const customValuation = parseNum(url.searchParams.get("customValuation"));
  if (customValuation !== null && customValuation > 0) {
    operatorInput.customValuation = customValuation;
  }

  const customOpeningBid = parseNum(url.searchParams.get("customOpeningBid"));
  if (customOpeningBid !== null && customOpeningBid > 0) {
    operatorInput.customOpeningBid = customOpeningBid;
  }

  const holdingMonths = parseNum(url.searchParams.get("holdingMonths"));
  if (holdingMonths !== null && holdingMonths > 0) {
    operatorInput.holdingMonths = Math.round(holdingMonths);
  }

  const homesteadParam = url.searchParams.get("isHomestead");
  if (homesteadParam === "true") operatorInput.isHomestead = true;
  else if (homesteadParam === "false") operatorInput.isHomestead = false;

  const taxSaleParam = url.searchParams.get("isTaxSale");
  if (taxSaleParam === "true") operatorInput.isTaxSale = true;
  else if (taxSaleParam === "false") operatorInput.isTaxSale = false;

  const cashFields = [
    "registrationFunds",
    "creditedDeposit",
    "buyersPremium",
    "sheriffPoundage",
    "transferTax",
    "delinquentTaxes",
    "settlementCosts",
  ] as const;

  for (const field of cashFields) {
    const amount = parseNum(url.searchParams.get(field));
    if (amount !== null) operatorInput[field] = amount;
  }

  const packet = buildDecisionPacket(listing, operatorInput);
  const format = String(url.searchParams.get("format") || "").toLowerCase();
  const accept = String(request.headers.get("accept") || "").toLowerCase();
  const isMarkdown =
    format === "markdown" ||
    format === "md" ||
    (accept.includes("text/markdown") && !accept.includes("application/json"));

  if (isMarkdown) {
    const md = formatDecisionPacketMarkdown(packet);
    return new Response(md, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `inline; filename="decision-packet-${encodeURIComponent(id)}.md"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return Response.json(packet, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `inline; filename="decision-packet-${encodeURIComponent(id)}.json"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  const session = readWorkspaceSession(request);
  if (session.authenticated && !hasPermission(session.role, "canExportDossier")) {
    return Response.json(
      {
        error: "Forbidden: Insufficient permissions to export underwriting decision packets",
        code: "PERMISSION_DENIED",
        role: session.role,
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  const member = session.authenticated ? null : await currentMember(request).catch(() => null);

  let forwardedRequest = request;
  try {
    const rawBody = await request.clone().json();
    if (rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)) {
      const payload: Record<string, unknown> = { ...(rawBody as Record<string, unknown>) };
      const positiveNum = (val: unknown): number | undefined => {
        if (val === null || val === undefined || val === "") return undefined;
        const n = Number(val);
        return Number.isFinite(n) && n > 0 ? n : undefined;
      };
      const customValuation = positiveNum(payload.customValuation);
      if (customValuation !== undefined) payload.customValuation = customValuation;
      const customOpeningBid = positiveNum(payload.customOpeningBid);
      if (customOpeningBid !== undefined) payload.customOpeningBid = customOpeningBid;
      const holdingMonths = positiveNum(payload.holdingMonths);
      if (holdingMonths !== undefined) payload.holdingMonths = Math.round(holdingMonths);
      if (typeof payload.isHomestead === "string") {
        if (payload.isHomestead === "true") payload.isHomestead = true;
        else if (payload.isHomestead === "false") payload.isHomestead = false;
      }
      if (typeof payload.isTaxSale === "string") {
        if (payload.isTaxSale === "true") payload.isTaxSale = true;
        else if (payload.isTaxSale === "false") payload.isTaxSale = false;
      }
      if (session.authenticated) {
        if (typeof payload.operatorId !== "string" || !payload.operatorId.trim()) {
          payload.operatorId = session.role;
        } else {
          payload.operatorId = payload.operatorId.trim();
        }
      } else if (member?.id) {
        // Paid members always attribute packet notes to their own account id.
        payload.operatorId = member.id;
      } else {
        delete payload.operatorId;
      }
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      headers.set("content-type", "application/json");
      forwardedRequest = new Request(request.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    }
  } catch {
    // Preserve non-JSON request stream when body cannot be parsed as JSON
  }

  if (session.authenticated) {
    return proxyPrivatePropertyApi(forwardedRequest);
  }
  return proxyMemberPropertyApi(forwardedRequest, { permission: "canExportDossier" });
}
