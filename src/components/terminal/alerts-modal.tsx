"use client";

import React, { useState, useEffect } from "react";
import { X, Bell, Plus, Trash2, CheckCircle, Shield, Mail, Zap } from "lucide-react";

export interface DealAlert {
  id: string;
  state: string;
  minScore: number;
  maxBid: number;
  email: string;
  createdAt: string;
  active: boolean;
}

interface AlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableStates: string[];
}

const DEFAULT_ALERTS: DealAlert[] = [
  {
    id: "alt-1",
    state: "All",
    minScore: 80,
    maxBid: 250000,
    email: "investor@firm.com",
    createdAt: new Date().toISOString(),
    active: true,
  },
];

export function AlertsModal({ isOpen, onClose, availableStates }: AlertsModalProps) {
  const [alerts, setAlerts] = useState<DealAlert[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem("perfectproperty:alerts");
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return DEFAULT_ALERTS;
  });

  const [state, setState] = useState("All");
  const [minScore, setMinScore] = useState(75);
  const [maxBid, setMaxBid] = useState(300000);
  const [email, setEmail] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Persist locally and sync with backend /api/alerts
  const saveAlertsLocally = (nextAlerts: DealAlert[]) => {
    setAlerts(nextAlerts);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("perfectproperty:alerts", JSON.stringify(nextAlerts));
      } catch (_) {}
    }
  };

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    const newAlert: DealAlert = {
      id: `alt-${Date.now()}`,
      state,
      minScore,
      maxBid: Number(maxBid),
      email: email.trim() || "investor@firm.com",
      createdAt: new Date().toISOString(),
      active: true,
    };

    const updated = [newAlert, ...alerts];
    saveAlertsLocally(updated);

    // Call backend API in background
    try {
      await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAlert),
      });
    } catch (_) {}

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleDeleteAlert = async (id: string) => {
    const updated = alerts.filter((a) => a.id !== id);
    saveAlertsLocally(updated);
    try {
      await fetch(`/api/alerts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (_) {}
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Deal Alerts Manager"
    >
      <div className="bg-[#0F172A] border border-white/10 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl text-white overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Automated Deal Alerts
              </h2>
              <p className="text-xs text-slate-400">
                Trigger notifications when high-equity foreclosure auctions match your criteria.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
            aria-label="Close Alerts Dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-6">
          {/* New Alert Form */}
          <form onSubmit={handleCreateAlert} className="space-y-4 p-4 rounded-xl bg-white/[0.03] border border-white/10">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                <span>Create New Alert Trigger</span>
              </span>
              {saveSuccess && (
                <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Alert Activated!</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                  State Market
                </label>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full h-9 rounded-lg bg-[#1E293B] border border-white/15 px-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                >
                  <option value="All">All 50 States</option>
                  {availableStates.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                  Min Deal Score: {minScore}
                </label>
                <input
                  type="range"
                  min={50}
                  max={95}
                  step={5}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="w-full mt-2 accent-amber-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                  Max Opening Bid
                </label>
                <select
                  value={maxBid}
                  onChange={(e) => setMaxBid(Number(e.target.value))}
                  className="w-full h-9 rounded-lg bg-[#1E293B] border border-white/15 px-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                >
                  <option value={150000}>Under $150k</option>
                  <option value={250000}>Under $250k</option>
                  <option value={500000}>Under $500k</option>
                  <option value={1000000}>Under $1M</option>
                  <option value={9999999}>Any Opening Bid</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                Notification Destination
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="acquisitions@investorfirm.com"
                  className="flex-1 h-9 rounded-lg bg-[#1E293B] border border-white/15 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  className="px-4 h-9 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Set Alert</span>
                </button>
              </div>
            </div>
          </form>

          {/* Active Alerts List */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Active Monitoring Triggers ({alerts.length})
            </h3>
            {alerts.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No active triggers set. Create one above to receive real-time notifications.
              </p>
            ) : (
              alerts.map((alt) => (
                <div
                  key={alt.id}
                  className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 flex items-center justify-between gap-4 hover:border-white/20 transition"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300">
                        {alt.state === "All" ? "National Feed" : `State: ${alt.state}`}
                      </span>
                      <span className="text-xs font-bold text-white">
                        Deal Score ≥ {alt.minScore}
                      </span>
                      <span className="text-xs text-slate-400">
                        • Max: ${alt.maxBid.toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <Mail className="w-3 h-3" />
                      <span>{alt.email}</span>
                      <span>• Added {new Date(alt.createdAt).toLocaleDateString()}</span>
                    </p>
                  </div>

                  <button
                    onClick={() => handleDeleteAlert(alt.id)}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition"
                    title="Delete trigger"
                    aria-label="Delete alert trigger"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 flex items-center justify-between text-xs text-slate-400 bg-white/[0.02]">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>Monitors 15 live government & county scraper streams</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
