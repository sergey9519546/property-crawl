import { NextResponse } from "next/server";

const API_BASE_URL = process.env.PROPERTY_API_URL || "http://localhost:3000";

export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Property API returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    return NextResponse.json({
      status: "ok",
      nextjs: "healthy",
      api: payload,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Property API unavailable";
    return NextResponse.json({
      status: "degraded",
      nextjs: "healthy",
      apiError: message,
      timestamp: new Date().toISOString(),
    }, { status: 200 });
  }
}
