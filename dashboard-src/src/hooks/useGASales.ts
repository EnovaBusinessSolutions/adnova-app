// dashboard-src/src/hooks/useGASales.ts
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { gaFetch, getGAProperty } from "./useGACommon";

// types
type TrendPoint = {
  date: string;
  revenue: number;
  purchases: number;
  sessions: number;
  conversionRate: number;
  aov: number;
};

type FunnelCounts = {
  view_item: number;
  add_to_cart: number;
  begin_checkout: number;
  purchase: number;
};

type SalesResp = {
  ok: boolean;
  data?: {
    revenue: number;
    purchases: number;
    purchaseConversionRate: number;
    aov: number;
    trend: TrendPoint[];
    funnel: FunnelCounts;

    prev?: {
      revenue: number;
      purchases: number;
      purchaseConversionRate: number;
      aov: number;
      funnel: FunnelCounts;
      convTotal: number; // purchase/view_item
    };
    deltas?: {
      revenue: number | null;
      purchases: number | null;
      purchaseConversionRate: number | null;
      aov: number | null;
      funnelConversion: number | null;
    };
  };
  error?: string;
};

export default function useGASales() {
  const [params] = useSearchParams();

  // ✅ property robusto (query -> localStorage -> null)
  const property = params.get("property") || getGAProperty() || "";

  // ✅ alinea con backend (tu backend soporta last_30d y last_30_days por el map)
  const date_preset = params.get("date_preset") || params.get("dateRange") || "last_30d";
  const include_today = params.get("include_today") || "0";

  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);
  const [data, setData] = useState<SalesResp["data"] | null>(null);

  const url = useMemo(() => {
    const sp = new URLSearchParams();
    if (property) sp.set("property", property);
    if (date_preset) sp.set("date_preset", date_preset);
    if (include_today) sp.set("include_today", include_today);
    const qs = sp.toString();
    return `/api/google/analytics/sales${qs ? `?${qs}` : ""}`;
  }, [property, date_preset, include_today]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setErr(null);

    // ✅ CLAVE: gaFetch (maneja ok:false, error, y tu normalización de property)
    gaFetch<SalesResp>(url)
      .then((json) => {
        if (cancelled) return;
        if (!json?.ok) throw new Error(json?.error || "GA sales error");
        setData(json.data || null);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setErr(e?.message || String(e));
        setData(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { property, loading, error, data };
}
