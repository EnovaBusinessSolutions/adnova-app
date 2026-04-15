import { useEffect, useMemo, useState } from "react";
import { getGAProperty, getGARange, gaFetch } from "./useGACommon";

export type GAFunnel = { view_item: number; add_to_cart: number; begin_checkout: number; purchase: number; };

export function useGAFunnel() {
  const property = useMemo(getGAProperty, []);
  const dateRange = useMemo(getGARange, []);
  const [steps, setSteps] = useState<GAFunnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        if (!property) { setErr("Selecciona una propiedad de GA4."); setLoading(false); return; }
        setLoading(true); setErr(null);
        const q = `property=${encodeURIComponent(property)}&dateRange=${encodeURIComponent(dateRange)}`;
        const json = await gaFetch<{ ok:boolean; steps:GAFunnel }>(`/api/google/analytics/funnel?${q}`);
        if (!cancel) setSteps(json.steps);
      } catch (e:any) {
        if (!cancel) setErr(e.message || "No se pudo cargar el Embudo.");
      } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [property, dateRange]);

  return { property, dateRange, steps, loading, error };
}
