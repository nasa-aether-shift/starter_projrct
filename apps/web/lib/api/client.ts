import type { z } from "zod";

import { env } from "@/lib/env";

import { ApiError, toProblem } from "./errors";
import { fixtureCsv, fixtureJson } from "./fixtures";
import { logApi } from "./log";

const TIMEOUT_MS = 20_000;

function parse<S extends z.ZodType>(schema: S, data: unknown, path: string): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`Response from ${path} did not match the contract`, result.error.issues);
    throw new ApiError(502, {
      type: "about:blank",
      title: "Unexpected response",
      detail: `The data from ${path} did not match the agreed format.`,
    });
  }
  return result.data;
}

async function request(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const res = await fetch(`${env.apiUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      const errBody: unknown = await res.json().catch(() => null);
      throw new ApiError(res.status, toProblem(res.status, errBody));
    }
    return res;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError" && signal?.aborted) throw err;
    throw new ApiError(0, {
      type: "about:blank",
      title: "Cannot reach the analysis server",
      detail: "Check the connection and try again.",
    });
  }
}

/** Fetches JSON (or answers from fixtures) and logs the call in development (lib/api/log.ts). */
async function fetchJson(method: "GET" | "POST", path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const source = env.useFixtures ? "FIXTURE" : "API";
  const t0 = performance.now();
  try {
    let status = 200;
    let data: unknown;
    if (env.useFixtures) data = await fixtureJson(method, path, body);
    else {
      const res = await request(method, path, body, signal);
      status = res.status;
      data = await res.json();
    }
    logApi({ source, method, path, status, ms: performance.now() - t0, body, data });
    return data;
  } catch (err) {
    // A cancelled request (navigation, React's dev double-mount) is not worth a log line.
    if (!(err instanceof DOMException && err.name === "AbortError"))
      logApi({
        source,
        method,
        path,
        status: err instanceof ApiError ? err.status || "error" : "error",
        ms: performance.now() - t0,
        body,
        error: err,
      });
    throw err;
  }
}

export async function apiGet<S extends z.ZodType>(path: string, schema: S, signal?: AbortSignal): Promise<z.infer<S>> {
  return parse(schema, await fetchJson("GET", path, undefined, signal), path);
}

export async function apiPost<S extends z.ZodType>(
  path: string,
  body: unknown,
  schema: S,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  return parse(schema, await fetchJson("POST", path, body, signal), path);
}

/** Downloads the run CSV and saves it in the browser. */
export async function downloadRunCsv(runId: string): Promise<void> {
  const path = `/runs/${encodeURIComponent(runId)}/csv`;
  const text = env.useFixtures ? await fixtureCsv(runId) : await (await request("GET", path)).text();
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${runId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
