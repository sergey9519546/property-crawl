"use client";

import * as React from "react";

/**
 * Per-request CSP nonce for client-rendered <style> elements (e.g. the
 * shadcn chart theme CSS). Production `style-src` does not allow
 * 'unsafe-inline', so a style element without this nonce is blocked.
 * The nonce is generated per request in src/proxy.ts and read from the
 * `x-nonce` request header in the root layout (server) — this context
 * carries it across the server/client boundary.
 */
const NonceContext = React.createContext<string | null>(null);

export function NonceProvider({ nonce, children }: {
  nonce: string | null;
  children: React.ReactNode;
}) {
  return (
    <NonceContext.Provider value={nonce}>
      {children}
    </NonceContext.Provider>
  );
}

export function useNonce(): string | null {
  return React.useContext(NonceContext);
}
