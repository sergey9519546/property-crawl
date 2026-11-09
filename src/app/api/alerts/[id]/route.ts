import { proxyWatchlistPropertyApi } from "@/lib/workspace-proxy";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  url.pathname = "/api/alerts";
  return proxyWatchlistPropertyApi(
    new Request(url.toString(), {
      method: "DELETE",
      headers: {
        ...Object.fromEntries(request.headers.entries()),
        "content-type": "application/json",
      },
      body: JSON.stringify({ listingId: decodeURIComponent(id) }),
    })
  );
}
