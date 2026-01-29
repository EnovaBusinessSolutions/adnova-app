// dashboard-src/src/hooks/useMetaInsights.ts
import { useEffect, useMemo, useState } from "react";

export type MetaObjective = "ventas" | "alcance" | "leads";

export type MetaSeriesPoint = {
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  purchases: number;
  revenue: number;
};

export type MetaKpis = {
  
  ingresos?: number;
  compras?: number;
  valorPorCompra?: number;
  roas?: number;
  cpa?: number;
  cvr?: number;
  revenue?: number;
  gastoTotal?: number;
  cpc?: number;
  clics?: number;
  ctr?: number;
  views?: number;

  
  reach?: number;
  impressions?: number;
  frecuencia?: number;
  cpm?: number;

  
  leads?: number;
  cpl?: number;
};

type Resp = {
  ok: boolean;
  objective: MetaObjective;
  account_id: string | null;
  currencyCode?: string | null;
  kpis: MetaKpis;
  deltas: Record<string, number>;
  series: MetaSeriesPoint[];
  error?: string;
  detail?: any;
};

type Params = {
  objective: MetaObjective;
  datePreset: string;                  
  level: "account" | "campaign" | "adset" | "ad";
  accountId?: string;
  includeToday?: boolean;
  day?: string;                        
};

export function useMetaInsights(p: Params) {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const u = new URLSearchParams();
    u.set("objective", p.objective);
    u.set("date_preset", p.datePreset);
    u.set("level", p.level);
    if (p.accountId) u.set("account_id", p.accountId);
    if (p.includeToday) u.set("include_today", "1");
    if (p.day) u.set("day", p.day);
    return u.toString();
  }, [p.objective, p.datePreset, p.level, p.accountId, p.includeToday, p.day]);

  const refetch = () => {
    setLoading(true);
    fetch(`/api/meta/insights?${qs}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<Resp>;
      })
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "META_INSIGHTS_ERROR");
        setData(j);
        setError(null);
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refetch();
    
  }, [qs]);

  return { data, loading, error, refetch };
}
