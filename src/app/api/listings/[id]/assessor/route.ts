import { proxyPropertyApi } from "@/lib/property-api";
import { readWorkspaceSession, workspaceSessionConfiguration } from "@/lib/workspace-session";

export async function GET(request: Request) {
  const configuration = workspaceSessionConfiguration();
  if (configuration.configured && readWorkspaceSession(request).authenticated) {
    return proxyPropertyApi(request, { operatorToken: configuration.credential });
  }
  return proxyPropertyApi(request);
}
