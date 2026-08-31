import { NextResponse } from "next/server";

const API_BASE_URL = process.env.PROPERTY_API_URL || "http://localhost:3000";

type ListingRecord = Record<string, unknown>;

let lastSuccessfulListings: ListingRecord[] | null = null;
let lastSuccessfulAt: string | null = null;

export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/listings`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error(`Property API returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.listings)) {
      throw new Error("Property API response did not include a listings array");
    }

    lastSuccessfulListings = payload.listings;
    lastSuccessfulAt = new Date().toISOString();

    return NextResponse.json({
      status: "ready",
      source: "property-api",
      total: payload.listings.length,
      listings: payload.listings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Property API unavailable";

    if (lastSuccessfulListings) {
      return NextResponse.json({
        status: "ready",
        source: "property-api-cache",
        total: lastSuccessfulListings.length,
        listings: lastSuccessfulListings,
        stale: true,
        lastSuccessfulAt,
        warning: message,
      });
    }

    return NextResponse.json(
      {
        status: "unavailable",
        source: "property-api",
        total: 0,
        listings: [],
        error: message,
      },
      { status: 503 },
    );
  }
}
