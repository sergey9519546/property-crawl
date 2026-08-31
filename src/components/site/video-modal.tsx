"use client";
import React from "react";
import { X, CheckCircle2, ShieldAlert, Sparkles } from "lucide-react";

interface VideoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function VideoModal({ isOpen, onClose }: VideoModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center bg-black/50 backdrop-blur-md p-4 animate-in fade-in">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-[#E5E7EB] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between bg-white">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#16A34A]" />
            <h3 className="text-lg font-bold text-[#111827]">Live Underwriting Walkthrough Demo</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-[#6B7280] hover:text-[#111827] hover:bg-[#F5F6F7]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-8 space-y-6 bg-[#F5F6F7]">
          <div className="bg-white rounded-2xl p-6 border border-[#E5E7EB] shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold px-2.5 py-1 bg-[#16A34A]/10 text-[#16A34A] rounded-md">
                Cuyahoga County Judicial Sale CV-24-991204
              </span>
              <span className="text-xs font-bold text-[#6B7280]">Appraisal: $110,000</span>
            </div>

            <h4 className="text-xl font-bold text-[#111827]">3841 E 55th St, Cleveland, OH 44105</h4>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="p-3 bg-[#F5F6F7] rounded-xl"><span className="text-[#6B7280] block">Opening Bid:</span><strong className="text-sm font-bold text-[#111827]">$38,000</strong></div>
              <div className="p-3 bg-[#F5F6F7] rounded-xl"><span className="text-[#6B7280] block">Median Comp:</span><strong className="text-sm font-bold text-[#111827]">$118,500</strong></div>
              <div className="p-3 bg-[#E7FAEF] rounded-xl border border-[#3AAF57]/30"><span className="text-[#16A34A] font-bold block">Gross Spread:</span><strong className="text-sm font-bold text-[#16A34A]">+$80,500</strong></div>
            </div>

            <div className="p-4 bg-[#F8FAFC] rounded-xl border border-[#E5E7EB] text-xs leading-relaxed space-y-2">
              <p className="font-bold text-[#111827]">⚡ AI "Here's the Catch" Findings:</p>
              <div className="space-y-1.5 text-[#374151]">
                <p className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" /> First mortgage foreclosure with complete defendant service.</p>
                <p className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" /> Statutory 2/3 minimum bid requirement satisfied.</p>
                <p className="flex items-center gap-1.5 text-[#B91C1C]"><ShieldAlert className="w-3.5 h-3.5 text-[#B91C1C]" /> $1,240 municipal utility lien must be settled at closing.</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-[#0F172A] text-white font-bold text-xs rounded-xl hover:bg-[#1E293B] transition"
            >
              Close Walkthrough
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
