"use client";

import * as React from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export function ContactForm() {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) return;
    window.localStorage.setItem(
      "perfectproperty:contact-request",
      JSON.stringify({ name, email, company, message, at: new Date().toISOString() }),
    );
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
        <h3 className="mt-4 text-lg font-bold text-[#111827]">Message saved</h3>
        <p className="mt-2 text-sm text-[#475569]">
          Thank you, {name.split(" ")[0]}. Your request is saved on this device.
          A monitored support address will respond before public launch.
        </p>
        <button
          onClick={() => {
            setSubmitted(false);
            setName("");
            setEmail("");
            setCompany("");
            setMessage("");
          }}
          className="mt-5 text-sm font-semibold text-[#0F172A] hover:underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-name" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#64748B]">
            Name
          </label>
          <input
            id="contact-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            className="h-12 w-full rounded-xl border border-[#D1D5DB] bg-white px-4 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0F172A]/10"
          />
        </div>
        <div>
          <label htmlFor="contact-email" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#64748B]">
            Work email
          </label>
          <input
            id="contact-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@company.com"
            className="h-12 w-full rounded-xl border border-[#D1D5DB] bg-white px-4 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0F172A]/10"
          />
        </div>
      </div>
      <div>
        <label htmlFor="contact-company" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#64748B]">
          Company <span className="font-normal text-[#9CA3AF]">(optional)</span>
        </label>
        <input
          id="contact-company"
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="BlueLine Capital"
          className="h-12 w-full rounded-xl border border-[#D1D5DB] bg-white px-4 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0F172A]/10"
        />
      </div>
      <div>
        <label htmlFor="contact-message" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#64748B]">
          How can we help?
        </label>
        <textarea
          id="contact-message"
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          placeholder="Tell us about your acquisitions workflow or what you need from the beta…"
          className="w-full rounded-xl border border-[#D1D5DB] bg-white px-4 py-3 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0F172A]/10"
        />
      </div>
      <button
        type="submit"
        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0F172A] px-6 text-sm font-bold text-white transition-colors hover:bg-[#1E293B]"
      >
        Send message
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  );
}
