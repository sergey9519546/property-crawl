export function buildContentSecurityPolicy(options?: {
  nonce?: string;
  isDev?: boolean;
  upgradeInsecureRequests?: boolean;
}): string;

export function scriptSrcAllowsUnsafeInline(policy: string): boolean;

export function requestUsesHttps(request: {
  headers?: { get?: (name: string) => string | null };
  nextUrl?: { protocol?: string };
}): boolean;
