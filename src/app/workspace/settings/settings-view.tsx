"use client";

import * as React from "react";
import { KeyRound, ShieldCheck, Database, Server, RefreshCw } from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";

export function WorkspaceSettingsView() {
  const session = useWorkspaceSession();
  const [healthData, setHealthData] = React.useState<{
    status?: string;
    dataMode?: string;
    postgresReachable?: boolean;
    inventoryFreshness?: string;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    void fetch("/api/health", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (active) {
          setHealthData(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Operator Workspace Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Runtime configuration, session security parameters, and persistence mode.
        </p>
      </div>

      <div className="space-y-6">
        {/* Session Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <KeyRound className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Operator Session</h2>
              <p className="text-xs text-slate-500">8-hour HttpOnly session cookie boundary</p>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
            <div className="rounded-lg bg-slate-50 p-4">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Authentication Status</dt>
              <dd className="mt-1 font-semibold text-slate-900">
                {session.authenticated ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700">
                    <span className="h-2 w-2 rounded-full bg-emerald-600" />
                    Unlocked (Operator Verified)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-slate-500">
                    <span className="h-2 w-2 rounded-full bg-slate-400" />
                    Locked
                  </span>
                )}
              </dd>
            </div>

            <div className="rounded-lg bg-slate-50 p-4">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Session Expiry</dt>
              <dd className="mt-1 text-slate-700 font-mono text-xs">
                {session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "Not active"}
              </dd>
            </div>
          </dl>
        </div>

        {/* Persistence & Health Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <Database className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Persistence Engine</h2>
              <p className="text-xs text-slate-500">Underlying catalog and observation storage</p>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
            <div className="rounded-lg bg-slate-50 p-4">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Storage Mode</dt>
              <dd className="mt-1 font-semibold text-slate-900">
                {loading ? "Checking..." : healthData?.dataMode || "unavailable"}
              </dd>
            </div>

            <div className="rounded-lg bg-slate-50 p-4">
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">PostgreSQL Status</dt>
              <dd className="mt-1 text-slate-700">
                {loading ? (
                  "Checking..."
                ) : healthData?.postgresReachable ? (
                  <span className="text-emerald-700 font-medium">Connected & Verified</span>
                ) : (
                  <span className="text-amber-700 font-medium">Embedded / Standalone</span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        {/* Security Invariants Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-700">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Security Invariants</h2>
              <p className="text-xs text-slate-500">Active protection boundaries</p>
            </div>
          </div>

          <ul className="mt-4 space-y-2 text-xs text-slate-600">
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              Content-Security-Policy: Cryptographic per-request dynamic nonce (strict-dynamic)
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              SSRF Defenses: Loopback/Private IP filtering on webhooks and crawler lanes
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              Operational Truth: Closed does not equal sold; bidsPlaced does not drive velocity
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
