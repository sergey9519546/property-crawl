"use client";

import { FormEvent, useState } from "react";
import { Check, Loader2, Mail } from "lucide-react";
import { useLocale } from "@/components/i18n/locale-provider";

export interface CountyAlertSubscribeProps {
  state: string;
  county: string;
  formalCounty: string;
}

export function CountyAlertSubscribe({
  state,
  county,
  formalCounty,
}: CountyAlertSubscribeProps) {
  const { locale, messages: m, format } = useLocale();
  const [email, setEmail] = useState("");
  const [cadence, setCadence] = useState<"daily" | "instant">("daily");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMessage(m.states.countyAlertEmailRequired);
      setStatus("error");
      return;
    }

    setStatus("loading");
    setErrorMessage("");

    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "subscribe_county_digest",
          email: cleanEmail,
          state,
          county,
          cadence,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(locale === "en" && typeof data.error === "string" ? data.error : m.states.countyAlertFailed);
      }

      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        locale === "en" && err instanceof Error ? err.message : m.states.countyAlertFailed
      );
    }
  }

  return (
    <div className="rounded-card border border-line bg-card p-6 shadow-xs">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-lg font-bold text-ink">
          {format(m.states.countyAlertTitle, { county: formalCounty })}
        </h3>
        <p className="text-sm text-ink-2">
          {format(m.states.countyAlertSub, { county: formalCounty })}
        </p>
      </div>

      {status === "success" ? (
        <div className="mt-4 flex items-center gap-2 rounded-control bg-go-wash p-3.5 text-sm font-medium text-go">
          <Check className="h-4 w-4 shrink-0" />
          <span>{format(m.states.countyAlertSuccess, { county: formalCounty })}</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink-3">{m.states.frequencyLabel}</span>
            <div className="inline-flex rounded-control border border-line bg-paper p-0.5">
              <button
                type="button"
                onClick={() => setCadence("daily")}
                className={`rounded-control px-2.5 py-1 text-xs font-medium transition-colors ${
                  cadence === "daily"
                    ? "bg-card text-ink font-semibold"
                    : "text-ink-2 hover:text-ink"
                }`}
              >
                {m.states.dailyDigest}
              </button>
              <button
                type="button"
                onClick={() => setCadence("instant")}
                className={`rounded-control px-2.5 py-1 text-xs font-medium transition-colors ${
                  cadence === "instant"
                    ? "bg-card text-ink font-semibold"
                    : "text-ink-2 hover:text-ink"
                }`}
              >
                {m.states.instantAlert}
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-ink-3">
                <Mail className="h-4 w-4" />
              </div>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (status === "error") {
                    setStatus("idle");
                    setErrorMessage("");
                  }
                }}
                placeholder={m.accountUi.emailPlaceholder}
                disabled={status === "loading"}
                className="w-full rounded-control border border-line-strong bg-card pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-ink transition-colors disabled:opacity-60"
              />
            </div>
            <button
              type="submit"
              disabled={status === "loading"}
              className="inline-flex items-center justify-center gap-2 rounded-control bg-go px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {status === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
              {m.states.subscribeAlertsBtn}
            </button>
          </div>

          {status === "error" && errorMessage && (
            <p role="alert" className="text-xs text-catch-ink">
              {errorMessage}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

export default CountyAlertSubscribe;
