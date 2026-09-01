import { NextResponse } from "next/server";

const API_BASE_URL = process.env.PROPERTY_API_URL || "http://localhost:3000";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = request.headers.get("x-user-id") || searchParams.get("userId") || "guest_user";
    const response = await fetch(`${API_BASE_URL}/api/alerts?userId=${encodeURIComponent(userId)}`, {
      headers: { "x-user-id": userId },
      cache: "no-store",
    });

    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Property API unavailable";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = request.headers.get("x-user-id") || "guest_user";
    const body = await request.json();
    const response = await fetch(`${API_BASE_URL}/api/alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": userId,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Property API unavailable";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = request.headers.get("x-user-id") || "guest_user";
    const body = await request.json();
    const response = await fetch(`${API_BASE_URL}/api/alerts`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": userId,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Property API unavailable";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
