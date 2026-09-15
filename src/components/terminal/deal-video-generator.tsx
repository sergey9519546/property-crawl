"use client";

import { VideoOff } from "lucide-react";
import { Listing } from "@/data/listings";

interface DealVideoProps {
  listing: Listing;
}

export function DealVideoGenerator({ listing }: DealVideoProps) {
  void listing;
  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] p-6 text-center">
      <VideoOff className="mx-auto h-8 w-8 text-slate-400" />
      <h4 className="mt-3 text-sm font-bold text-slate-700">Deal video generation is not available yet</h4>
      <p className="mt-1 text-xs text-slate-500">This feature is under development.</p>
    </div>
  );
}
