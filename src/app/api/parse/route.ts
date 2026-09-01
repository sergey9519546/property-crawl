import { NextResponse } from "next/server";

const API_BASE_URL = process.env.PROPERTY_API_URL || "http://localhost:3000";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(`${API_BASE_URL}/api/parse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Property API unavailable";
    return NextResponse.json(
      { error: message },
      { status: 503 },
    );
  }
}
