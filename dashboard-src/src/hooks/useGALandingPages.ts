import { useEffect, useMemo, useState } from "react";
import { getGAProperty, getGARange, gaFetch } from "./useGACommon";

export type GALandingRow = { landingPage: string; sessions: number; users: number; engagementRate: number; };

export function useGALandingPages() {
  const property = useMemo(getGAProperty, []);
  const dateRange = useMemo(getGARange, []);
  const [rows, setRows] = useState<GALandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        if (!property) { setErr("Selecciona una propiedad de GA4."); setLoading(false); return; }
        setLoading(true); setErr(null);
        const q = `property=${encodeURIComponent(property)}&dateRange=${encodeURIComponent(dateRange)}`;
        const json = await gaFetch<{ ok:boolean; rows:GALandingRow[] }>(`/api/google/analytics/landing-pages?${q}`);
        if (!cancel) setRows(json.rows || []);
      } catch (e:any) {
        if (!cancel) setErr(e.message || "No se pudieron cargar Landing Pages.");
      } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [property, dateRange]);

  return { property, dateRange, rows, loading, error };
}
