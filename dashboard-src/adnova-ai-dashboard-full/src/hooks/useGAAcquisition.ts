import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

export type GAChannels = Record<string, number>; // proporciones 0–1
export type GAAcqTrendPoint = { date: string; sessions: number; newUsers: number };

export type GAAcqResp = {
  kpis: { totalUsers: number; sessions: number; newUsers: number };
  deltas?: Partial<Record<"totalUsers"|"sessions"|"newUsers", number>> | null;
  channels: GAChannels;
  trend: GAAcqTrendPoint[];
};

export default function useGAAcquisition() {
  const [params] = useSearchParams();
  const property = params.get("property") || "";
  const date_preset = params.get("date_preset") || "last_30d";
  const include_today = params.get("include_today") || "0";

  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);
  const [data, setData] = useState<GAAcqResp | null>(null);

  useEffect(() => {
    if (!property) return;
    let cancel = false;
    (async () => {
      try {
        setLoading(true); setErr(null);
        const qs = new URLSearchParams({ property, date_preset, include_today }).toString();
        const r = await fetch(`/api/google/analytics/acquisition?${qs}`, { credentials: "include" });
        const j = await r.json();
        if (cancel) return;
        if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);

        const k = j.kpis || {};
        const channels = j.channels || {};
        const trend = Array.isArray(j.trend) ? j.trend.map((p:any)=>({
          date: String(p.date), sessions: Number(p.sessions||0), newUsers: Number(p.newUsers||0)
        })) : [];
        setData({
          kpis: {
            totalUsers: Number(k.totalUsers||0),
            sessions: Number(k.sessions||0),
            newUsers: Number(k.newUsers||0),
          },
          deltas: j.deltas ?? null,
          channels,
          trend,
        });
      } catch (e:any) {
        if (!cancel) setErr(e.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [property, date_preset, include_today]);

  return { property, loading, error, data };
}
