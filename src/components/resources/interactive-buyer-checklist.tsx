"use client";

import * as React from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";

export interface ChecklistItem {
  id: string;
  text: string;
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: "read-notice", text: "Read the sale notice twice: date, place, deposit, and how to pay." },
  { id: "read-catch", text: 'Open the listing and read "the catch" first.' },
  { id: "check-occupancy", text: "Find out whether the home is occupied." },
  { id: "check-liens", text: "Look up liens and unpaid taxes on the property. We do not provide title reports." },
  { id: "check-rules", text: "Check your state's redemption and confirmation rules (table above)." },
  { id: "check-bankruptcy", text: "Check for a bankruptcy filing just before the sale." },
  { id: "prep-deposit", text: "Have your deposit ready in the form the notice asks for." },
  { id: "confirm-sale", text: "Call the county to confirm the sale is still on." },
];

const STORAGE_KEY = "perfectproperty_buyer_diligence_checklist_v1";

export function InteractiveBuyerChecklist({
  items = DEFAULT_CHECKLIST,
}: {
  items?: ChecklistItem[];
}) {
  const [completed, setCompleted] = React.useState<Record<string, boolean>>({});
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setCompleted(JSON.parse(stored));
      }
    } catch {
      // Ignore local storage parse errors
    }
    setMounted(true);
  }, []);

  const toggle = (id: string) => {
    setCompleted((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore local storage write errors
      }
      return next;
    });
  };

  const resetAll = () => {
    setCompleted({});
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  };

  const completedCount = items.filter((i) => completed[i.id]).length;
  const allComplete = completedCount === items.length && items.length > 0;

  return (
    <div className="rounded-3xl border border-line bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-[0.1em] text-ink-3">
            Interactive Checklist
          </span>
          <p className="mt-0.5 text-sm font-semibold text-ink">
            {mounted ? (
              <span>
                {completedCount} of {items.length} completed
                {allComplete ? " — Ready for auction" : ""}
              </span>
            ) : (
              <span>0 of {items.length} completed</span>
            )}
          </p>
        </div>
        {mounted && completedCount > 0 ? (
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-3 hover:bg-paper hover:text-ink transition"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        ) : null}
      </div>

      <ul className="mt-4 space-y-2.5">
        {items.map((item) => {
          const isDone = mounted && Boolean(completed[item.id]);
          return (
            <li key={item.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={isDone}
                onClick={() => toggle(item.id)}
                className={`flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition ${
                  isDone
                    ? "border-emerald-200 bg-emerald-50/40 text-ink dark:border-emerald-900/40 dark:bg-emerald-950/10"
                    : "border-line bg-paper/60 text-ink-2 hover:border-line-strong hover:bg-paper"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition ${
                    isDone
                      ? "bg-emerald-600 text-white"
                      : "border border-line-strong bg-card"
                  }`}
                >
                  {isDone ? <CheckCircle2 className="h-4 w-4" /> : null}
                </span>
                <span
                  className={`text-sm leading-relaxed ${
                    isDone ? "font-medium text-ink line-through opacity-80" : "text-ink-2"
                  }`}
                >
                  {item.text}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
