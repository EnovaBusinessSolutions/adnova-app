import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

export type EngagementPoint = {
  date: string;
  engagementRate: number;   // 0–1
  avgTime: number;          // seconds
};

export type EngagementResp = {
  engagementRate: number;       // 0–1
  avgEngagementTime: number;    // seconds
  trend: EngagementPoint[];
  deltas?: { engagementRate?: number; avgEngagementTime?: number } | null;
};

type Raw = {
  ok: boolean;
  engagementRate?: number;
  avgEngagementTime?: number;
  trend?: EngagementPoint[];
  deltas?: { engagementRate?: number; avgEngagementTime?: number };
  error?: string;
};

export default function useGAEngagement() {
  const [params] = useSearchParams();
  const property = params.get("property") || "";
  const date_preset = params.get("date_preset") || "last_30d";
  const include_today = params.get("include_today") || "0";

  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);
  const [data, setData] = useState<EngagementResp | null>(null);

  useEffect(() => {
    if (!property) return;
    let cancel = false;
    (async () => {
      try {
        setLoading(true); setErr(null);
        const qs = new URLSearchParams({ property, date_preset, include_today }).toString();
        const r = await fetch(`/api/google/analytics/engagement?${qs}`, { credentials: "include" });
        const j: Raw = await r.json();
        if (cancel) return;
        if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);

        setData({
          engagementRate: Number(j.engagementRate || 0),
          avgEngagementTime: Number(j.avgEngagementTime || 0),
          trend: Array.isArray(j.trend) ? j.trend.map(p => ({
            date: String(p.date),
            engagementRate: Number(p.engagementRate || 0),
            avgTime: Number(p.avgTime || 0),
          })) : [],
          deltas: j.deltas ?? null,
        });
      } catch (e: any) {
        if (!cancel) setErr(e.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [property, date_preset, include_today]);

  return { property, loading, error, data };
}
