"use client";

import * as React from "react";

/**
 * Production error boundary — prevents a single component crash
 * (e.g. WebGL shader failure) from blanking the entire page.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // In production, this is where you'd ship to Sentry/Datadog.
    // For now, log to console so dev catches it.
    if (process.env.NODE_ENV !== "production") {
      console.error("ErrorBoundary caught:", error, info);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="hidden" aria-hidden>
            {/* Silent fallback — failed component just disappears */}
          </div>
        )
      );
    }
    return this.props.children;
  }
}
