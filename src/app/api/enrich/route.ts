import { NextResponse } from "next/server";

const API_BASE_URL = process.env.PROPERTY_API_URL || "http://localhost:3000";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(`${API_BASE_URL}/api/enrich`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Property API returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Property API unavailable";
    return NextResponse.json(
      { error: message },
      { status: 503 },
    );
  }
}
