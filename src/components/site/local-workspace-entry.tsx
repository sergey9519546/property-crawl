/**
 * Deprecated dead component — not imported by any route.
 * Kept only so the file is not silently deleted from git history awareness;
 * do not import. Product watchlists use the server operator-key model.
 */
export function LocalWorkspaceEntry() {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
      Local browser-only workspace is not part of this beta. Use the listing
      workspace; research writes require the shared operator credential
      (see <a className="underline" href="/sign-in">Operator access</a>).
    </div>
  );
}
