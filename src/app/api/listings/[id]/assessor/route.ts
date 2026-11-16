import { proxyPropertyApi } from "@/lib/property-api";
import { hasPermission, readWorkspaceSession, workspaceSessionConfiguration } from "@/lib/workspace-session";

export async function GET(request: Request) {
  const configuration = workspaceSessionConfiguration();
  const session = configuration.configured ? readWorkspaceSession(request) : null;
  if (configuration.configured && session?.authenticated && hasPermission(session.role, "canReviewDocuments")) {
    return proxyPropertyApi(request, { operatorToken: configuration.credential });
  }
  return proxyPropertyApi(request);
}
