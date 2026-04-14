import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

export type GAObjective = "ventas" | "leads" | "adquisicion" | "engagement";
export type GAOverviewData = Record<string, any>;

// =============================
// Cache/Dedupe simple (por URL)
// =============================
const GA_CACHE = new Map<string, { ts: number; data: any }>();
const GA_INFLIGHT = new Map<string, Promise<any>>();
const TTL_MS = 10_000;

function parseBool(v: string | null, fallback = false) {
  if (v === null || v === undefined || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function endpointForObjective(obj: GAObjective) {
  if (obj === "ventas") return "sales";
  if (obj === "leads") return "leads";
  if (obj === "adquisicion") return "acquisition";
  return "engagement";
}

async function fetchWithDedupe(url: string, signal: AbortSignal) {
  // cache hit
  const hit = GA_CACHE.get(url);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.data;

  // inflight dedupe
  const inflight = GA_INFLIGHT.get(url);
  if (inflight) return inflight;

  const p = (async () => {
    const r = await fetch(url, { credentials: "include", signal });
    const json = await r.json().catch(() => null);

    if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
    if (json?.ok === false) {
      // soporta { reason, requiredSelection } y { error }
      throw new Error(json?.error || json?.reason || "GA error");
    }

    // ✅ normalización definitiva:
    // backend: { ok, property, range, data:{...} }
    const normalized = (json && typeof json === "object" && "data" in json) ? (json as any).data : json;

    GA_CACHE.set(url, { ts: Date.now(), data: normalized });
    return normalized;
  })();

  GA_INFLIGHT.set(url, p);
  try {
    const out = await p;
    return out;
  } finally {
    GA_INFLIGHT.delete(url);
  }
}

export function useGAOverview() {
  const [sp] = useSearchParams();

  const property = sp.get("property") || localStorage.getItem("ga_property") || "";
  const date_preset = sp.get("date_preset") || sp.get("dateRange") || "last_30d";
  const includeToday = parseBool(sp.get("include_today"), false);
  const objective = (sp.get("objective") || "ventas") as GAObjective;

  // lead events (solo para leads)
  const leadEventsParam = sp.get("lead_events") || "";

  const [data, setData] = useState<GAOverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = useMemo(() => {
    const endpoint = endpointForObjective(objective);

    const qs = new URLSearchParams();
    if (property) qs.set("property", property);
    if (date_preset) qs.set("date_preset", String(date_preset));
    qs.set("include_today", includeToday ? "1" : "0");

    if (objective === "leads") {
      const le = leadEventsParam?.trim()
        ? leadEventsParam
        : "generate_lead,form_submit,contact_click";
      qs.set("lead_events", le);
    }

    return `/api/google/analytics/${endpoint}?${qs.toString()}`;
  }, [property, date_preset, includeToday, objective, leadEventsParam]);

  useEffect(() => {
    if (!property) {
      setData(null);
      setError(null);
      return;
    }

    try {
      localStorage.setItem("ga_property", property);
    } catch {}

    const ac = new AbortController();

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const normalized = await fetchWithDedupe(url, ac.signal);

        // ✅ aquí ya es “data interna”, NO wrapper
        setData(normalized);
      } catch (e: any) {
        if (ac.signal.aborted) return;
        setError(e?.message || String(e));
        setData(null);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [url, property]);

  return { data, loading, error, objective, property, date_preset, includeToday, url };
}
