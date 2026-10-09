"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpenCheck, Crosshair, Database, FileWarning, Home, KeyRound, ListFilter, LockKeyhole, LogOut, X } from "lucide-react";
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
  { href: "/workspace/documents-review", label: "Reviews", icon: FileWarning },
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

/**
 * The session, or null while it is still unknown.
 *
 * `useWorkspaceSession` returns `defaultSession` when there is no provider
 * above, which reports authenticated: false. That is a fine default for
 * anything that only renders, but it is a lie to anything that *acts*: a
 * caller cannot tell "not signed in" from "have not asked yet", and a badge
 * that fetches on that answer issues a request guaranteed to 401.
 *
 * The home page has no WorkspaceShell -- it keeps the marketing header -- so it
 * has no provider and no real answer. Rather than force the whole marketing
 * page into the workspace shell, this hook asks the server itself when there is
 * no provider, and returns null until that answer lands. Pages that do have a
 * shell keep using it and make no extra request.
 */
export function useResolvedWorkspaceSession(): SessionState | null {
  const fromContext = React.useContext(SessionContext);
  const [probed, setProbed] = React.useState<SessionState | null>(null);

  React.useEffect(() => {
    // A provider exists: it already probes, and it owns the answer.
    if (fromContext) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/workspace/session", { cache: "no-store", credentials: "same-origin" });
        const result = await response.json();
        if (cancelled) return;
        setProbed({
          authenticated: Boolean(response.ok && result.authenticated),
          configured: result.configured !== false,
          expiresAt: typeof result.expiresAt === "string" ? result.expiresAt : null,
          loading: false,
          requestUnlock: () => {},
          refresh: async () => false,
        });
      } catch {
        if (!cancelled) {
          setProbed({ ...defaultSession, loading: false });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [fromContext]);

  return fromContext ?? probed;
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
      // Per-session rate-limit bucket key.
      let sid = "";
      try {
        sid = sessionStorage.getItem("pp_unlock_sid") || "";
        if (!sid) {
          sid = crypto.randomUUID();
          sessionStorage.setItem("pp_unlock_sid", sid);
        }
      } catch { /* sessionStorage unavailable */ }
      const response = await fetch("/api/workspace/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(sid ? { "x-unlock-sid": sid } : {}) },
        body: JSON.stringify({ credential }),
      });
      const result = await response.json();
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        setError(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? `Too many attempts. Wait ${retryAfter} seconds and try again.`
            : "Too many attempts. Wait a moment and try again.",
        );
        return;
      }
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
          <nav aria-label="Research workspace" className="order-3 flex w-full flex-nowrap overflow-x-auto gap-1 sm:order-none sm:w-auto sm:flex-1">
            {navigation.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("shrink-0 inline-flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold transition sm:shrink-0 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-xs", active ? "bg-[#0F172A] text-white" : "text-[#374151] hover:bg-[#F3F4F6] hover:text-[#111827]")}><Icon size={14} />{item.label}</Link>;
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/" className="hidden items-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold text-[#5B6472] hover:bg-[#F3F4F6] md:flex"><Home size={14} />Site</Link>
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
      <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); (unlockOpener.current || document.body).focus(); }} className="z-[100] gap-0 rounded-2xl bg-white p-6 text-slate-950 sm:max-w-md">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-900">Operator access</p><DialogTitle className="mt-2 text-2xl font-semibold">Unlock operator tools</DialogTitle></div><button type="button" disabled={submitting} aria-label="Close unlock dialog" onClick={() => { setUnlockOpen(false); setCredential(""); }} className="rounded-xl p-2 hover:bg-slate-100"><X size={18} /></button></div>
        <DialogDescription className="mt-3 text-sm leading-6 text-slate-600">This beta uses a single shared operator key. Anyone with the key can access research, hunts, and activity.</DialogDescription>
        <form onSubmit={unlock} className="mt-5">
          <label htmlFor="workspace-credential" className="text-xs font-semibold">Operator key <span className="sr-only">(Workspace access key)</span></label>
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-300 px-3"><KeyRound size={16} className="text-slate-400" /><input id="workspace-credential" autoFocus required disabled={submitting} type="password" autoComplete="current-password" value={credential} onChange={(event) => setCredential(event.target.value)} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" /></div>
          {!configured && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">Enter the operator key configured for this deployment.</p>}
          {error && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">{error}</p>}
          <button disabled={submitting || !configured} className="mt-4 w-full rounded-xl bg-[#0F172A] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1E293B] disabled:opacity-50">{submitting ? "Unlocking…" : "Unlock workspace"}</button>
        </form>
      </DialogContent>
    </Dialog>
  </SessionContext.Provider>;
}

export function PrivateWorkspaceGate({ title = "Unlock your research workspace", headingLevel = 2, children }: { title?: string; headingLevel?: 1 | 2 | 3; children?: React.ReactNode }) {
  const session = useWorkspaceSession();
  // headingLevel exists because the answer is not uniform.
  //
  // Four of the five consumers put their own <h1> inside the children, so the
  // default of 2 is right for them: the page keeps its h1 and the lock screen
  // is a subsection of it.
  //
  // research-case.tsx is the exception. Its h1 lives inside `detail &&`, so
  // while locked there is no page heading at all, and the lock screen was the
  // only thing on the page carrying an <h2> under no <h1>. It opts into 1.
  //
  // This cannot be checked statically: the h1 is in a child that the locked
  // branch never renders. It is why the accessibility audit asserts h1 presence
  // in the live DOM.
  const Heading = `h${headingLevel}` as 'h1' | 'h2' | 'h3';
  if (session.loading) return <section className="rounded-2xl border border-[#E5E7EB] bg-white p-7 text-sm text-[#5B6472] shadow-sm"><Heading className="text-xl font-semibold text-[#111827]">Checking the private workspace</Heading><p className="mt-2">Confirming your operator session…</p></section>;
  if (session.authenticated) return <>{children}</>;
  return <section className="rounded-2xl border border-[#E5E7EB] bg-white p-7 shadow-sm"><LockKeyhole className="text-slate-900" /><Heading className="mt-4 text-xl font-semibold">{title}</Heading><p className="mt-2 max-w-xl text-sm leading-6 text-[#5B6472]">Cases and decision history are private. Unlock once to use every research and collection tool in this workspace.</p><button type="button" onClick={session.requestUnlock} className="mt-5 rounded-xl bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1E293B]">Unlock workspace</button></section>;
}
