"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { Logo } from "@/components/site/logo";
import { AppleIcon } from "@/components/site/apple-icon";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5F6F7] px-5 py-16">
      <div className="w-full max-w-[400px]">
        <Link href="/" className="mb-8 flex items-center justify-center" aria-label="PerfectProperty home">
          <Logo className="text-[18px]" />
        </Link>

        <div className="rounded-3xl border border-[#E2E8F0] bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight text-[#111827]">Sign in</h1>
          <p className="mt-2 text-sm text-[#64748B]">
            Welcome back. Sign in to access your watchlist and saved searches.
          </p>

          <button
            type="button"
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-black px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <AppleIcon className="h-5 w-5" />
            Continue with Apple
          </button>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#E2E8F0]" />
            <span className="text-xs font-medium text-[#94A3B8]">or</span>
            <div className="h-px flex-1 bg-[#E2E8F0]" />
          </div>

          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div>
              <label htmlFor="signin-email" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#64748B]">
                Email
              </label>
              <input
                id="signin-email"
                type="email"
                placeholder="you@company.com"
                className="h-12 w-full rounded-xl border border-[#D1D5DB] bg-white px-4 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0F172A]/10"
              />
            </div>
            <div>
              <label htmlFor="signin-password" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#64748B]">
                Password
              </label>
              <input
                id="signin-password"
                type="password"
                placeholder="••••••••"
                className="h-12 w-full rounded-xl border border-[#D1D5DB] bg-white px-4 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0F172A]/10"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0F172A] text-sm font-bold text-white transition-colors hover:bg-[#1E293B]"
            >
              Sign in
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[#64748B]">
            Don't have an account?{" "}
            <Link href="/register" className="font-semibold text-[#0F172A] hover:underline">
              Create one
            </Link>
          </p>
        </div>

        <Link href="/" className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-[#64748B] hover:text-[#111827]">
          <ArrowLeft className="h-4 w-4" />
          Back to PerfectProperty
        </Link>
      </div>
    </main>
  );
}
