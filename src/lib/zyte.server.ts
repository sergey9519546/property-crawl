/**
 * Server-only Zyte API and Scrapy Cloud integration wrapper.
 * Spec: C:\Users\serge\.gemini\config\skills\zyte-scrapy\SKILL.md
 *
 * Rules:
 * - Server-only execution.
 * - Gated on ZYTE_API_KEY.
 * - Never log or expose API keys.
 */

import {
  zyteConfigured,
  zyteFetch as serverZyteFetch,
  zyteFetchLike as serverZyteFetchLike,
  scrapyCloudListJobs as serverScrapyCloudListJobs,
  scheduleZyteJob as serverScheduleZyteJob,
  DEFAULT_PROJECT_ID,
} from "@server/scrapers/zyte-client";

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

export { zyteConfigured, DEFAULT_PROJECT_ID };

export async function zyteFetch(url: string, opts?: ZyteFetchOptions): Promise<ZyteFetchResult> {
  return serverZyteFetch(url, opts);
}

export async function zyteFetchLike(url: string, opts?: ZyteFetchOptions): Promise<ZyteFetchLikeResponse> {
  return serverZyteFetchLike(url, opts);
}

export async function scrapyCloudListJobs(opts?: {
  projectId?: string;
  count?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ScrapyListJobsResult> {
  return serverScrapyCloudListJobs(opts);
}

export async function scheduleZyteJob(opts: ScheduleZyteJobOptions): Promise<ScheduleZyteJobResult> {
  return serverScheduleZyteJob(opts);
}
