/**
 * Server-only Zyte API and Scrapy Cloud integration wrapper.
 * Spec: C:\Users\serge\.gemini\config\skills\zyte-scrapy\SKILL.md
 *
 * Rules:
 * - Server-only execution (Node runtime; Edge bundles fail closed without loading node:net).
 * - Gated on ZYTE_API_KEY.
 * - Never log or expose API keys.
 */

import type * as ZyteClient from "@server/scrapers/zyte-client";

export interface ZyteFetchOptions {
  browser?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export interface ZyteFetchResult {
  ok: boolean;
  status: number;
  html?: string;
  browser?: boolean;
  url?: string;
  error?: string;
}

export interface ZyteFetchLikeResponse {
  ok: boolean;
  status: number;
  url: string;
  text: () => Promise<string>;
  json: <T = unknown>() => Promise<T>;
}

export interface ScrapyJob {
  id: string;
  spider: string;
  state: "running" | "finished" | "pending";
  items?: number;
  elapsed?: number;
  started_time?: string;
  close_reason?: string;
}

export interface ScrapyListJobsResult {
  ok: boolean;
  status: number;
  jobs: ScrapyJob[];
  total?: number;
  error?: string;
}

export interface ScheduleZyteJobOptions {
  spider: string;
  recipe?: string;
  projectId?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ScheduleZyteJobResult {
  ok: boolean;
  status: number;
  jobId?: string | null;
  prevJobId?: string | null;
  error?: string;
}

export const DEFAULT_PROJECT_ID = "870105";

function loadServerZyte(): typeof ZyteClient | null {
  if (process.env.NEXT_RUNTIME === "edge") {
    return null;
  }
  return require("@server/scrapers/zyte-client") as typeof ZyteClient;
}

export function zyteConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const client = loadServerZyte();
  if (!client) {
    return Boolean(String(env.ZYTE_API_KEY || "").trim());
  }
  return client.zyteConfigured(env);
}

export async function zyteFetch(url: string, opts?: ZyteFetchOptions): Promise<ZyteFetchResult> {
  const client = loadServerZyte();
  if (!client) {
    return { ok: false, status: 503, error: "ZYTE_NODE_RUNTIME_REQUIRED" };
  }
  return client.zyteFetch(url, opts);
}

export async function zyteFetchLike(url: string, opts?: ZyteFetchOptions): Promise<ZyteFetchLikeResponse> {
  const client = loadServerZyte();
  if (!client) {
    return {
      ok: false,
      status: 503,
      url,
      text: async () => "",
      json: async () => ({} as never),
    };
  }
  return client.zyteFetchLike(url, opts);
}

export async function scrapyCloudListJobs(opts?: {
  projectId?: string;
  count?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ScrapyListJobsResult> {
  const client = loadServerZyte();
  if (!client) {
    return { ok: false, status: 503, jobs: [], error: "ZYTE_NODE_RUNTIME_REQUIRED" };
  }
  return client.scrapyCloudListJobs(opts);
}

export async function scheduleZyteJob(opts: ScheduleZyteJobOptions): Promise<ScheduleZyteJobResult> {
  const client = loadServerZyte();
  if (!client) {
    return { ok: false, status: 503, error: "ZYTE_NODE_RUNTIME_REQUIRED" };
  }
  return client.scheduleZyteJob(opts);
}
