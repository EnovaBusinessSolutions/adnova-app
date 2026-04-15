// dashboard-src/src/hooks/useGALeads.ts
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

export type LeadPoint = { date: string; leads: number; conversionRate: number }; // 0–1

export type LeadsResp = {
  leads: number;
  conversionRate: number; // 0–1
  trend: LeadPoint[];
  deltas?: { leads?: number; conversionRate?: number } | null;
};

type RawResp = {
  ok: boolean;
  leads?: number;
  conversionRate?: number;
  trend?: LeadPoint[];
  deltas?: { leads?: number; conversionRate?: number };
  error?: string;
};

export default function useGALeads() {
  const [params] = useSearchParams();

  // filtros globales
  const property = params.get("property") || "";
  const date_preset = params.get("date_preset") || "last_30d";
  const include_today = params.get("include_today") || "0";

  
  const lead_events = useMemo(() => {
    const fromQuery = (params.get("lead_events") || "").trim();
    if (fromQuery) return fromQuery;

    const fromEnv =
      (import.meta as any)?.env?.VITE_GA_LEAD_EVENTS ||
      (typeof process !== "undefined" ? (process as any).env?.VITE_GA_LEAD_EVENTS : "");
    if (fromEnv && typeof fromEnv === "string") return fromEnv;

    // fallback
    return "generate_lead,form_submit,contact_click";
  }, [params]);

  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);
  const [data, setData] = useState<LeadsResp | null>(null);

  useEffect(() => {
    if (!property) return;
    let cancel = false;

    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const qs = new URLSearchParams({
          property,
          date_preset,
          include_today,
          lead_events, // 👈 IMPORTANTE: ahora sí enviamos los eventos de lead
        }).toString();

        const r = await fetch(`/api/google/analytics/leads?${qs}`, {
          credentials: "include",
        });
        const json: RawResp = await r.json();
        if (cancel) return;

        if (!r.ok || !json.ok) {
          throw new Error(json.error || `HTTP ${r.status}`);
        }

        // Normaliza para no tener undefined en la UI
        const normalized: LeadsResp = {
          leads: Number(json.leads || 0),
          conversionRate: Number(json.conversionRate || 0),
          trend: Array.isArray(json.trend)
            ? json.trend.map((p) => ({
                date: String(p.date),
                leads: Number(p.leads || 0),
                conversionRate: Number(p.conversionRate || 0),
              }))
            : [],
          deltas: json.deltas ?? null,
        };

        setData(normalized);
      } catch (e: any) {
        if (!cancel) setErr(e.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [property, date_preset, include_today, lead_events]);

  return { property, loading, error, data };
}
