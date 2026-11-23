import { proxyPropertyApi } from "@/lib/property-api";
import { proxyPrivatePropertyApi } from "@/lib/workspace-proxy";

export const maxDuration = 60;

// Read-only cached evidence & pre-warmed narrative lookup (zero live LLM calls).
export const GET = (request: Request) => proxyPropertyApi(request);

// The deterministic evidence summary is public. Requests that ask for an LLM
// narrative spend provider quota, so they require an unlocked workspace session.
export const POST = async (request: Request) => {
  let wantsAi = false;
  try {
    const body = (await request.clone().json()) as { includeAiNarrative?: unknown; useAi?: unknown } | null;
    wantsAi = Boolean(body && (body.includeAiNarrative || body.useAi));
  } catch {
    // Unparseable bodies fall through to the public proxy, which rejects them.
  }
  return wantsAi
    ? proxyPrivatePropertyApi(request, { permission: "canReviewDocuments" })
    : proxyPropertyApi(request);
};
