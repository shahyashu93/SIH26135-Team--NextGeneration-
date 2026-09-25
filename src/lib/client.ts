"use client";
import { useEffect, useState } from "react";

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result as T;
}
export function useResource<T>(path: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ path: string; revision: number; data?: T; error?: string }>({ path: "", revision: -1 });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/${path}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load this view.");
      return data as T;
    }).then(data => setState({ path, revision, data })).catch(error => { if (!controller.signal.aborted) setState({ path, revision, error: error.message }); });
    return () => controller.abort();
  }, [path, revision]);
  return { data: state.data, error: state.error, loading: state.path !== path || state.revision !== revision, refresh: () => setRevision(value => value + 1) };
}