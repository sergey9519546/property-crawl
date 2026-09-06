"use client";

import { Download } from "lucide-react";
import { useSearchParams } from "next/navigation";

/** Export retains the active discovery query so the file is reproducible. */
export function DiscoveryExportAction() {
  const search = useSearchParams();
  const params = new URLSearchParams(search.toString());
  params.set("format", "csv");
  return <a href={`/api/export?${params.toString()}`} className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-3 text-xs font-bold text-white shadow-xl hover:bg-slate-800"><Download size={15} />Export this query</a>;
}
