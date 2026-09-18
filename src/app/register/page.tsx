import Link from "next/link";

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Accounts</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Registration is not open</h1>
      <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-600 shadow-sm">
        <p>
          This build does not sell or issue public user accounts. Access is a
          <strong className="text-slate-900"> shared-operator private beta</strong>.
        </p>
        <p>
          If you received an operator credential, use the workspace unlock control after opening
          the listing workspace. If you need product access, contact the operator listed on the
          contact page.
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/listings" className="inline-flex h-12 items-center rounded-xl bg-[#0F172A] px-5 text-sm font-semibold text-white hover:bg-[#1E293B]">
          Open listings
        </Link>
        <Link href="/sign-in" className="inline-flex h-12 items-center rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50">
          Operator access notes
        </Link>
      </div>
    </main>
  );
}
