import propertyImageRoute from "@/lib/server-routes/property-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PropertyImageResult = {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
};

const propertyImageService = (
  propertyImageRoute as typeof propertyImageRoute & {
    createPropertyImageService(options: { db: { getListingById(id: string): Promise<unknown> } }): {
      resolve(request: ReturnType<typeof requestShape>): Promise<PropertyImageResult>;
    };
  }
).createPropertyImageService({
  // In-memory ingestion lives in the Node process. Resolve the same listing
  // the page displays instead of querying a separate Next.js snapshot store.
  db: {
    async getListingById(id: string) {
      const apiUrl = process.env.PROPERTY_API_URL || "http://localhost:3000";
      const response = await fetch(`${apiUrl}/api/listings/${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Listing service unavailable");
      return response.json();
    },
  },
});

function requestShape(request: Request) {
  return {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
  };
}

function webResponse(result: PropertyImageResult) {
  const body = result.body instanceof Uint8Array
    ? result.body
    : JSON.stringify(result.body);
  return new Response(body as BodyInit, {
    status: result.status,
    headers: result.headers,
  });
}

export async function GET(request: Request) {
  const result = await propertyImageService.resolve(requestShape(request));
  return webResponse(result);
}
