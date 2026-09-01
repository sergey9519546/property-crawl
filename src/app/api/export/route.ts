import { NextResponse } from "next/server";

const API_BASE_URL = process.env.PROPERTY_API_URL || "http://localhost:3000";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "csv";
    const userId = request.headers.get("x-user-id") || searchParams.get("userId") || "";

    const queryParams = new URLSearchParams({ format });
    if (userId) queryParams.set("userId", userId);

    const response = await fetch(`${API_BASE_URL}/api/export?${queryParams.toString()}`, {
      headers: userId ? { "x-user-id": userId } : {},
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Property API returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || (format === "json" ? "application/json" : "text/csv; charset=utf-8");
    const contentDisposition = response.headers.get("content-disposition") || `attachment; filename="property_crawl_export.${format}"`;

    const body = await response.text();

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Property API unavailable";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
