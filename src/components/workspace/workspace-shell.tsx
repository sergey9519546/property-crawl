"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, UserRound, Activity, Banknote, BookOpenCheck, Calculator, Crosshair, Database, FileWarning, Home, KeyRound, ListFilter, LockKeyhole, LogOut, PieChart, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/site/logo";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useLocale } from "@/components/i18n/locale-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type MemberState = { email: string; entitled: boolean } | null;

export type WorkspaceRole = "operator" | "analyst" | "viewer";

type SessionState = {
  /** Operator session (shared key). */
  authenticated: boolean;
  /** Authenticated workspace role when unlocked. */
  role: WorkspaceRole | null;
  /** Fine-grained permissions granted to the current session. */
  permissions: string[];
  /** Signed-in email member, entitled or not. */
  member: MemberState;
  /** Per-user tools (hunts, watchlist, portfolio, alerts) are usable. */
  memberTools: boolean;
  configured: boolean;
  expiresAt: string | null;
  loading: boolean;
  requestUnlock: () => void;
  refresh: () => Promise<boolean>;
};

const SessionContext = React.createContext<SessionState | null>(null);

function readMember(value: unknown): MemberState {
  const m = value as { email?: unknown; entitled?: unknown } | null;
  return m && typeof m.email === "string" ? { email: m.email, entitled: m.entitled === true } : null;
}

function parseRole(value: unknown): WorkspaceRole | null {
  return value === "operator" || value === "analyst" || value === "viewer" ? value : null;
}

function parsePermissions(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const defaultSession: SessionState = {
  authenticated: false,
  role: null,
  permissions: [],
  member: null,
  memberTools: false,
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

export function useResolvedWorkspaceSession(): SessionState | null {
  const fromContext = React.useContext(SessionContext);
  const [probed, setProbed] = React.useState<SessionState | null>(null);

  React.useEffect(() => {
    if (fromContext) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/workspace/session", { cache: "no-store", credentials: "same-origin" });
        const result = await response.json();
        if (cancelled) return;
        const authenticated = Boolean(response.ok && result.authenticated);
        const member = response.ok ? readMember(result.member) : null;
        setProbed({
          authenticated,
          role: authenticated ? parseRole(result.role) : null,
          permissions: authenticated ? parsePermissions(result.permissions) : [],
          member,
          memberTools: authenticated || Boolean(member?.entitled),
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

export function WorkspaceSessionProvider({ children, includeChrome = false }: { children: React.ReactNode; includeChrome?: boolean }) {
  const pathname = usePathname();
  const { messages } = useLocale();
  const nav = messages.workspace.nav;
  const navigation = React.useMemo(
    () => [
      { href: "/listings", label: nav.discover, icon: ListFilter },
      { href: "/research", label: nav.research, icon: BookOpenCheck },
      { href: "/hunts", label: nav.hunts, icon: Crosshair },
      { href: "/portfolio", label: nav.portfolio, icon: PieChart },
      { href: "/bid-sheet", label: "Bid Sheet", icon: Banknote },
      { href: "/underwrite", label: "Underwrite", icon: Calculator },
      { href: "/sources", label: nav.sources, icon: Database },
      { href: "/activity", label: nav.activity, icon: Activity },
      { href: "/workspace/documents-review", label: "Reviews", labelText: nav.reviews, icon: FileWarning },
      { href: "/workspace/settings", label: nav.status, icon: Settings },
    ],
    [nav],
  );

  const [authenticated, setAuthenticated] = React.useState(false);
  const [role, setRole] = React.useState<WorkspaceRole | null>(null);
  const [permissions, setPermissions] = React.useState<string[]>([]);
  const [member, setMember] = React.useState<MemberState>(null);
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
      setRole(accepted ? parseRole(result.role) : null);
      setPermissions(accepted ? parsePermissions(result.permissions) : []);
      setMember(response.ok ? readMember(result.member) : null);
      setConfigured(result.configured !== false);
      setExpiresAt(typeof result.expiresAt === "string" ? result.expiresAt : null);
      return accepted;
    } catch {
      if (requestId !== authRequest.current) return false;
      setAuthenticated(false);
      setRole(null);
      setPermissions([]);
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
      setAuthenticated(true); setRole(parseRole(result.role)); setPermissions(parsePermissions(result.permissions)); setConfigured(true); setLoading(false); setExpiresAt(result.expiresAt || null); setCredential(""); setUnlockOpen(false); setShellError("");
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
      setAuthenticated(false); setRole(null); setPermissions([]); setExpiresAt(null);
    } catch {
      setShellError("Workspace could not be locked. Please try again.");
    } finally { setSubmitting(false); setLoading(false); }
  }

  const context = React.useMemo<SessionState>(() => ({
    authenticated, role, permissions, member, memberTools: authenticated || Boolean(member?.entitled), configured, expiresAt, loading,
    requestUnlock: openUnlock,
    refresh,
  }), [authenticated, role, permissions, member, configured, expiresAt, loading, refresh, openUnlock]);

  const dlg = messages.workspace.unlockDialog;

  return <SessionContext.Provider value={context}>
    <div className="workspace-shell min-h-screen bg-paper text-ink">
      {includeChrome ? (<header className="sticky top-0 z-40 border-b border-line bg-card/95 px-4 py-3 shadow-sm backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-3">
          <Link href="/" className="mr-2 flex items-center" aria-label={messages.common.homeAria}><Logo className="text-body" /></Link>
          <nav aria-label="Research workspace" data-i18n-label={messages.workspace.navAria} className="order-3 flex w-full flex-nowrap overflow-x-auto gap-1 sm:order-none sm:w-auto sm:flex-1">
            {navigation.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("shrink-0 inline-flex flex-col items-center justify-center gap-1 rounded-control px-2 py-2 text-label font-semibold transition sm:shrink-0 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-xs", active ? "bg-ink text-white" : "text-ink-2 hover:bg-line hover:text-ink")}><Icon size={14} />{"labelText" in item ? item.labelText : item.label}</Link>;
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher />
            <Link href="/" className="hidden items-center gap-1 rounded-control px-2 py-2 text-xs font-semibold text-ink-3 hover:bg-line md:flex"><Home size={14} />{messages.common.site}</Link>
            <Link href={member ? "/account" : "/sign-in"} className="inline-flex items-center gap-1 rounded-control border border-line-strong px-3 py-2 text-xs font-semibold text-ink hover:bg-line"><UserRound size={14} />{member ? (member.entitled ? messages.common.account : messages.common.subscribe) : messages.common.signIn}</Link>
            {authenticated ? <button type="button" disabled={submitting} onClick={() => void logout()} className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-semibold disabled:opacity-50"><LogOut size={14} />{submitting ? messages.common.locking : messages.common.lock}</button>
              : <button type="button" onClick={openUnlock} className="inline-flex items-center gap-1.5 rounded-control bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-ink-2"><LockKeyhole size={14} />{loading ? messages.common.checking : messages.common.unlock}</button>}
          </div>
        </div>
      </header>) : null}
      {authenticated && expiresAt && <p className="sr-only">Private operator session expires {new Date(expiresAt).toLocaleString()}.</p>}
      {shellError ? <p role="alert" className="mx-auto my-3 max-w-[1440px] rounded-control bg-catch-wash px-5 py-3 text-sm text-catch-ink">{shellError}</p> : null}
      {children}
    </div>
    <Dialog open={unlockOpen} onOpenChange={(value) => { if (!submitting) { setUnlockOpen(value); if (!value) setCredential(""); } }}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); (unlockOpener.current || document.body).focus(); }} className="z-[100] gap-0 rounded-card bg-card p-6 text-ink sm:max-w-md">
        <div className="flex items-start justify-between gap-4"><div><p className="text-label font-bold uppercase tracking-[0.16em] text-ink">{dlg.eyebrow}</p><DialogTitle className="mt-2 text-2xl font-semibold">{dlg.title}</DialogTitle></div><button type="button" disabled={submitting} aria-label={dlg.closeAria} onClick={() => { setUnlockOpen(false); setCredential(""); }} className="rounded-control p-2 hover:bg-line"><X size={18} /></button></div>
        <DialogDescription className="mt-3 text-sm leading-6 text-ink-3">{dlg.description}</DialogDescription>
        <Link href={member && !member.entitled ? "/account" : "/sign-in"} onClick={() => setUnlockOpen(false)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-control border border-ink px-4 py-3 text-sm font-semibold text-ink hover:bg-paper"><UserRound size={16} />{member && !member.entitled ? dlg.inactiveSubCta : dlg.emailSignInCta}</Link>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">{dlg.operatorKeyHeading}</p>
        <p className="mt-1 text-xs leading-5 text-ink-3">{dlg.operatorKeyDesc}</p>
        <form onSubmit={unlock} className="mt-5">
          <label htmlFor="workspace-credential" className="text-xs font-semibold">{dlg.operatorKeyLabel} <span className="sr-only">{dlg.operatorKeySrOnly}</span></label>
          <div className="mt-2 flex items-center gap-2 rounded-control border border-line-strong bg-card px-3 focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20"><KeyRound size={16} className="text-ink-3" /><input id="workspace-credential" autoFocus required disabled={submitting} type="password" autoComplete="current-password" value={credential} onChange={(event) => setCredential(event.target.value)} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none focus-visible:shadow-none" /></div>
          {!configured && <p className="mt-3 rounded-control bg-paper p-3 text-xs leading-5 text-ink-2">{dlg.configuredHint}</p>}
          {error && <p role="alert" className="mt-3 rounded-control bg-catch-wash p-3 text-xs leading-5 text-catch-ink">{error}</p>}
          <button disabled={submitting || !configured} className="mt-4 w-full rounded-control bg-ink px-4 py-3 text-sm font-semibold text-white hover:bg-ink-2 disabled:opacity-50">{submitting ? dlg.unlockingBtn : dlg.unlockBtn}</button>
        </form>
      </DialogContent>
    </Dialog>
  </SessionContext.Provider>;
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return <WorkspaceSessionProvider includeChrome>{children}</WorkspaceSessionProvider>;
}

export function PrivateWorkspaceGate({ title, headingLevel = 2, allowMember = false, children }: { title?: string; headingLevel?: 1 | 2 | 3; allowMember?: boolean; children?: React.ReactNode }) {
  const session = useWorkspaceSession();
  const { messages } = useLocale();
  const gate = messages.workspace.privateGate;
  const resolvedTitle = title || gate.defaultTitle;
  const Heading = `h${headingLevel}` as 'h1' | 'h2' | 'h3';
  if (session.loading) return <section className="rounded-card border border-line bg-card p-7 text-sm text-ink-3 shadow-sm"><Heading className="text-xl font-semibold text-ink">{gate.checkingTitle}</Heading><p className="mt-2">{gate.checkingBody}</p></section>;
  if (session.authenticated || (allowMember && session.memberTools)) return <>{children}</>;
  return <section className="rounded-card border border-line bg-card p-7 shadow-sm"><LockKeyhole className="text-ink" /><Heading className="mt-4 text-xl font-semibold">{resolvedTitle}</Heading><p className="mt-2 max-w-xl text-sm leading-6 text-ink-3">{gate.body}</p><button type="button" onClick={session.requestUnlock} className="mt-5 rounded-control bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-2">{gate.unlockBtn}</button></section>;
}
