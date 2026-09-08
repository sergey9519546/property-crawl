"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpenCheck, Crosshair, Database, Home, KeyRound, ListFilter, LockKeyhole, LogOut, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/site/logo";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type SessionState = {
  authenticated: boolean;
  configured: boolean;
  expiresAt: string | null;
  loading: boolean;
  requestUnlock: () => void;
  refresh: () => Promise<boolean>;
};

const SessionContext = React.createContext<SessionState | null>(null);

const navigation = [
  { href: "/listings", label: "Discover", icon: ListFilter },
  { href: "/research", label: "Research", icon: BookOpenCheck },
  { href: "/hunts", label: "Hunts", icon: Crosshair },
  { href: "/sources", label: "Sources", icon: Database },
  { href: "/activity", label: "Activity", icon: Activity },
];

const defaultSession: SessionState = {
  authenticated: false,
  configured: false,
  expiresAt: null,
  loading: false,
  requestUnlock: () => {},
  refresh: async () => false,
};

export function useWorkspaceSession() {
  const value = React.useContext(SessionContext);
  return value ?? defaultSession;
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [authenticated, setAuthenticated] = React.useState(false);
  const [configured, setConfigured] = React.useState(true);
  const [expiresAt, setExpiresAt] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [unlockOpen, setUnlockOpen] = React.useState(false);
  const [credential, setCredential] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [shellError, setShellError] = React.useState("");
  const authRequest = React.useRef(0);
  const unlockOpener = React.useRef<HTMLElement | null>(null);

  const refresh = React.useCallback(async () => {
    const requestId = ++authRequest.current;
    try {
      const response = await fetch("/api/workspace/session", { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (requestId !== authRequest.current) return false;
      const accepted = Boolean(response.ok && result.authenticated);
      setAuthenticated(accepted);
      setConfigured(result.configured !== false);
      setExpiresAt(typeof result.expiresAt === "string" ? result.expiresAt : null);
      return accepted;
    } catch {
      if (requestId !== authRequest.current) return false;
      setAuthenticated(false);
      setExpiresAt(null);
      return false;
    } finally { if (requestId === authRequest.current) setLoading(false); }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => {
    if (!authenticated || !expiresAt) return;
    const remaining = Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timer = window.setTimeout(() => void refresh(), Math.max(0, Math.min(remaining + 100, 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [authenticated, expiresAt, refresh]);
  React.useEffect(() => {
    const checkSession = () => { if (!submitting && document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", checkSession);
    return () => window.removeEventListener("focus", checkSession);
  }, [refresh, submitting]);
  const openUnlock = React.useCallback(() => {
    unlockOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCredential(""); setError(""); setUnlockOpen(true);
  }, []);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    ++authRequest.current;
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/workspace/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Workspace could not be unlocked");
      setAuthenticated(true); setConfigured(true); setLoading(false); setExpiresAt(result.expiresAt || null); setCredential(""); setUnlockOpen(false); setShellError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Workspace could not be unlocked"); }
    finally { setSubmitting(false); setLoading(false); }
  }

  async function logout() {
    if (submitting) return;
    ++authRequest.current;
    setSubmitting(true); setShellError("");
    try {
      const response = await fetch("/api/workspace/session", { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("Workspace could not be locked. Please try again.");
      setAuthenticated(false); setExpiresAt(null);
    } catch {
      setShellError("Workspace could not be locked. Please try again.");
    } finally { setSubmitting(false); setLoading(false); }
  }

  const context = React.useMemo<SessionState>(() => ({
    authenticated, configured, expiresAt, loading,
    requestUnlock: openUnlock,
    refresh,
  }), [authenticated, configured, expiresAt, loading, refresh, openUnlock]);

  return <SessionContext.Provider value={context}>
    <div className="workspace-shell min-h-screen bg-[#F5F6F7] text-[#111827]">
      <header className="sticky top-0 z-40 border-b border-[#E5E7EB] bg-white/95 px-4 py-3 shadow-sm backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-3">
          <Link href="/" className="mr-2 flex items-center" aria-label="PerfectProperty home"><Logo className="text-[16px]" /></Link>
          <nav aria-label="Research workspace" className="order-3 grid w-full grid-cols-5 gap-1 sm:order-none sm:flex sm:w-auto sm:flex-1">
            {navigation.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("inline-flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold transition sm:shrink-0 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-xs", active ? "bg-[#0F172A] text-white" : "text-[#374151] hover:bg-[#F3F4F6] hover:text-[#111827]")}><Icon size={14} />{item.label}</Link>;
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/" className="hidden items-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold text-[#6B7280] hover:bg-[#F3F4F6] md:flex"><Home size={14} />Site</Link>
            {authenticated ? <button type="button" disabled={submitting} onClick={() => void logout()} className="inline-flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"><LogOut size={14} />{submitting ? "Locking…" : "Lock"}</button>
              : <button type="button" onClick={openUnlock} className="inline-flex items-center gap-1.5 rounded-xl bg-[#0F172A] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1E293B]"><LockKeyhole size={14} />{loading ? "Checking…" : "Unlock"}</button>}
          </div>
        </div>
      </header>
      {authenticated && expiresAt && <p className="sr-only">Private operator session expires {new Date(expiresAt).toLocaleString()}.</p>}
      {shellError ? <p role="alert" className="mx-auto my-3 max-w-[1440px] rounded-xl bg-amber-50 px-5 py-3 text-sm text-amber-950">{shellError}</p> : null}
      {children}
    </div>
    <Dialog open={unlockOpen} onOpenChange={(value) => { if (!submitting) { setUnlockOpen(value); if (!value) setCredential(""); } }}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); unlockOpener.current?.focus(); }} className="z-[100] gap-0 rounded-2xl bg-white p-6 text-slate-950 sm:max-w-md">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-900">Private research workspace</p><DialogTitle className="mt-2 text-2xl font-semibold">Unlock operator tools</DialogTitle></div><button type="button" disabled={submitting} aria-label="Close unlock dialog" onClick={() => { setUnlockOpen(false); setCredential(""); }} className="rounded-xl p-2 hover:bg-slate-100"><X size={18} /></button></div>
        <DialogDescription className="mt-3 text-sm leading-6 text-slate-600">Save properties, searches, and research in your private workspace. Access lasts eight hours.</DialogDescription>
        <form onSubmit={unlock} className="mt-5">
          <label htmlFor="workspace-credential" className="text-xs font-semibold">Workspace access key</label>
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-300 px-3"><KeyRound size={16} className="text-slate-400" /><input id="workspace-credential" autoFocus required disabled={submitting} type="password" autoComplete="current-password" value={credential} onChange={(event) => setCredential(event.target.value)} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" /></div>
          {!configured && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">Operator access is not configured. Set SCRAPER_ADMIN_TOKEN for both app processes, then restart them.</p>}
          {error && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">{error}</p>}
          <button disabled={submitting || !configured} className="mt-4 w-full rounded-xl bg-[#0F172A] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1E293B] disabled:opacity-50">{submitting ? "Unlocking…" : "Unlock workspace"}</button>
        </form>
      </DialogContent>
    </Dialog>
  </SessionContext.Provider>;
}

export function PrivateWorkspaceGate({ title = "Unlock your research workspace", children }: { title?: string; children?: React.ReactNode }) {
  const session = useWorkspaceSession();
  if (session.loading) return <div className="rounded-2xl border border-[#E5E7EB] bg-white p-7 text-sm text-[#6B7280] shadow-sm">Checking the private workspace…</div>;
  if (session.authenticated) return <>{children}</>;
  return <section className="rounded-2xl border border-[#E5E7EB] bg-white p-7 shadow-sm"><LockKeyhole className="text-slate-900" /><h2 className="mt-4 text-xl font-semibold">{title}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#6B7280]">Cases and decision history are private. Unlock once to use every research and collection tool in this workspace.</p><button type="button" onClick={session.requestUnlock} className="mt-5 rounded-xl bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1E293B]">Unlock workspace</button></section>;
}
