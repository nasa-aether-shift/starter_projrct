import type { z } from "zod";

import { env } from "@/lib/env";

import { ApiError, toProblem } from "./errors";
import { fixtureCsv, fixtureJson } from "./fixtures";

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

export async function apiGet<S extends z.ZodType>(path: string, schema: S, signal?: AbortSignal): Promise<z.infer<S>> {
  const data = env.useFixtures
    ? await fixtureJson("GET", path)
    : await (await request("GET", path, undefined, signal)).json();
  return parse(schema, data, path);
}

export async function apiPost<S extends z.ZodType>(
  path: string,
  body: unknown,
  schema: S,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  const data = env.useFixtures
    ? await fixtureJson("POST", path, body)
    : await (await request("POST", path, body, signal)).json();
  return parse(schema, data, path);
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
