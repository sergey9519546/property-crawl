import { proxyPropertyApi } from "@/lib/property-api";
import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";
import { readWorkspaceSession, workspaceSessionConfiguration } from "@/lib/workspace-session";
import { buildDecisionPacket, formatDecisionPacketMarkdown } from "@server/export/decision-packet";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = readWorkspaceSession(request);
  const configuration = workspaceSessionConfiguration();

  // If the user has an unlocked operator/analyst workspace session, forward
  // to the canonical Node API with the operator credential.
  if (session.authenticated && configuration.configured) {
    return proxyPropertyApi(request, { operatorToken: configuration.credential });
  }

  // For public visitors on the detail page, build and return the evidentiary
  // decision packet directly from verified listing data.
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

  const base = process.env.PROPERTY_API_URL || "http://localhost:3000";
  let listing: any = null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/listings/${encodeURIComponent(id)}`, {
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
    // API down or network issue; fall through to local db query
  }

  if (!listing) {
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

  const operatorNotes = url.searchParams.get("operatorNotes");
  if (operatorNotes && operatorNotes.trim()) {
    operatorInput.operatorNotes = operatorNotes.trim();
  }

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
  // Overrides and custom underwriting mutations require operator credentials
  return proxyPrivatePropertyApi(request);
}
