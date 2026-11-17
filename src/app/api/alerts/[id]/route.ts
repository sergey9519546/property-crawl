import { proxyWatchlistPropertyApi } from "@/lib/workspace-proxy";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let listingId: string;
  try {
    listingId = decodeURIComponent(id);
  } catch {
    return Response.json({ error: "Invalid listing identifier encoding" }, { status: 400 });
  }
  const url = new URL(request.url);
  url.pathname = "/api/alerts";
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.delete("content-length");
  forwardedHeaders.delete("host");
  forwardedHeaders.delete("transfer-encoding");
  forwardedHeaders.set("content-type", "application/json");
  return proxyWatchlistPropertyApi(
    new Request(url.toString(), {
      method: "DELETE",
      headers: forwardedHeaders,
      body: JSON.stringify({ listingId }),
    })
  );
}
