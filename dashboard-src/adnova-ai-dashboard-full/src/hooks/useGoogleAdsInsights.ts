// dashboard-src/src/hooks/useGoogleAdsInsights.ts
// LIVE hook for Google Ads Insights (read-only, sin mocks)

import { useEffect, useMemo, useRef, useState } from "react";

export type GoogleObjective = "ventas" | "alcance" | "leads";

export interface AdsSeriesPoint {
  date: string;            // yyyy-mm-dd
  impressions: number;
  clicks: number;
  cost: number;            // currency units
  conversions: number;
  conv_value: number;
  ctr: number;             // 0..1
  cpc: number;
  cpm?: number;
  cpl?: number;
}

export interface AdsKpis {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conv_value: number;
  ctr: number;
  cpc: number;
  cpa?: number;
  roas?: number;
  cpm?: number;
  cpl?: number;
}

export interface AdsInsightsPayload {
  ok: boolean;
  objective: GoogleObjective;
  customer_id: string;
  range: { since: string; until: string };
  prev_range: { since: string; until: string };
  is_partial: boolean;
  kpis: AdsKpis;
  deltas: Record<string, number | null>;
  series: AdsSeriesPoint[];
  currency?: string;
  locale?: string;
  cachedAt?: string;
}

// ========= Helpers =========
export const normalizeCustomerId = (s?: string | null) =>
  String(s ?? "").replace(/[^0-9]/g, "");

function mapPresetToBackend(p?: string | null): string {
  const v = String(p ?? "").trim().toUpperCase();
  if (!v) return "last_30d";
  switch (v) {
    case "TODAY": return "today";
    case "YESTERDAY": return "yesterday";
    case "THIS_MONTH": return "this_month";
    case "LAST_7_DAYS":
    case "LAST_7D":
    case "LAST7":
    case "LAST7D":
      return "last_7d";
    case "LAST_14_DAYS":
    case "LAST_14D":
    case "LAST14":
    case "LAST14D":
      return "last_14d";
    case "LAST_28_DAYS":
    case "LAST_28D":
    case "LAST28":
    case "LAST28D":
      return "last_28d";
    case "LAST_60_DAYS":
    case "LAST_60D":
      return "last_60d";
    case "LAST_90_DAYS":
    case "LAST_90D":
      return "last_90d";
    case "LAST_30":
    case "LAST_30D":
    case "LAST30":
    case "LAST30D":
    case "LAST_30_DAYS":
    default:
      return "last_30d";
  }
}

async function fetchJson(url: string, signal?: AbortSignal) {
  const r = await fetch(url, {
    credentials: "include",
    signal,
    headers: { Accept: "application/json" },
  });
  const text = await r.text().catch(() => "");
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* ignore */ }
  return { ok: r.ok, status: r.status, data };
}

// ========= Hook =========
export function useGoogleAdsInsights(opts: {
  accountId?: string | null;
  customerId?: string | null;
  datePreset?: string | null;       // UI presets; se mapean a backend
  includeToday?: boolean;           // default 0
  objective?: GoogleObjective | null; // default 'ventas'
  rangeDays?: number | string | null;
  compareMode?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [data, setData]       = useState<AdsInsightsPayload | null>(null);

  const [requiredSelection, setRequiredSelection] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [usedCustomerId, setUsedCustomerId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Normaliza ID (prioridad a accountId)
  const cid = useMemo(() => {
    const prefer = opts.accountId ?? opts.customerId ?? null;
    return normalizeCustomerId(prefer);
  }, [opts.accountId, opts.customerId]);

  // Defaults robustos
  const backendPreset = useMemo(
    () => mapPresetToBackend(opts.datePreset),
    [opts.datePreset]
  );
  const objective = (opts.objective ?? "ventas") as GoogleObjective;
  const includeToday = opts.includeToday ? "1" : "0";

  // Construye query
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (cid) q.set("account_id", cid);
    q.set("date_preset", backendPreset); // siempre mandamos un preset válido
    q.set("include_today", includeToday); // siempre 0/1
    q.set("objective", String(objective)); // siempre objetivo
    if (opts.rangeDays != null && String(opts.rangeDays).trim() !== "") {
      q.set("range", String(opts.rangeDays));
    }
    if (opts.compareMode) q.set("compare_mode", String(opts.compareMode));
    return q.toString();
  }, [cid, backendPreset, includeToday, objective, opts.rangeDays, opts.compareMode]);

  const DEBUG = false; // ponlo en true si quieres ver la URL en consola

  async function load() {
    // Si no hay cuenta, informamos a la UI que seleccione
    if (!cid) {
      setRequiredSelection(true);
      setReason("SELECTION_REQUIRED:NO_ACCOUNT");
      setError(null);
      setData(null);
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    setRequiredSelection(false);
    setReason(null);

    const url = `/api/google/ads/insights?${query}`;
    if (DEBUG) console.log("[GAdsInsights] GET", url);

    try {
      const { ok, status, data: resp } = await fetchJson(url, ctrl.signal);

      if (!ok && status === 400 &&
          (resp?.requiredSelection || String(resp?.reason || "").startsWith("SELECTION_REQUIRED"))) {
        setRequiredSelection(true);
        setReason(resp?.reason || "SELECTION_REQUIRED");
        setLoading(false);
        return;
      }

      if (!ok && status === 401) {
        setError("UNAUTHORIZED");
        setLoading(false);
        return;
      }

      if (!ok || resp?.ok === false) {
        setError(resp?.error || `GOOGLE_ADS_ERROR_${status}`);
        setLoading(false);
        return;
      }

      const payload: AdsInsightsPayload = {
        ok: !!resp.ok,
        objective: resp.objective as GoogleObjective,
        customer_id: resp.customer_id,
        range: resp.range,
        prev_range: resp.prev_range,
        is_partial: !!resp.is_partial,
        kpis: resp.kpis,
        deltas: resp.deltas || {},
        series: Array.isArray(resp.series) ? resp.series : [],
        currency: resp.currency,
        locale: resp.locale,
        cachedAt: resp.cachedAt,
      };

      setData(payload);
      setUsedCustomerId(payload.customer_id || null);
      setLastUpdated(new Date().toISOString());
      setLoading(false);
    } catch (e: any) {
      if (e?.name === "AbortError") return; // navegación rápida: ignorar
      setError(e?.message || "NETWORK_ERROR");
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [cid, backendPreset, includeToday, objective, opts.rangeDays, opts.compareMode, query]);

  return {
    loading,
    error,
    data,
    refresh: load,
    requiredSelection,
    reason,
    usedCustomerId,
    lastUpdated,
  };
}
