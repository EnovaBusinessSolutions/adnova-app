// dashboard-src/src/hooks/useGAProperties.ts
import { useEffect, useMemo, useState } from "react";

export type GAPropertyMeta = {
  propertyId: string;  // "properties/123"
  displayName?: string | null;
  timeZone?: string | null;
  currencyCode?: string | null;
};

type Resp = {
  ok: boolean;
  properties: GAPropertyMeta[];
  defaultPropertyId?: string | null;
  error?: string;
};

// Tipo conveniente para usar en el frontend
export type GAPropertyItem = {
  id: string;           // propertyId
  label: string;        // solo el nombre
  currencyCode?: string | null;
  timeZone?: string | null;
};

export default function useGAProperties() {
  const [properties, setProperties] = useState<GAPropertyMeta[]>([]);
  const [defaultPropertyId, setDefaultPropertyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const r = await fetch("/api/google/analytics/properties", {
          credentials: "include",
        });
        const json: Resp = await r.json();

        if (!r.ok || json.ok === false) {
          throw new Error(json.error || `HTTP ${r.status}`);
        }

        if (!cancel) {
          setProperties(json.properties || []);
          setDefaultPropertyId(json.defaultPropertyId || null);
        }
      } catch (e: any) {
        if (!cancel) setErr(e.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

    return () => {
      cancel = true;
    };
  }, []);

  // Ítems listos para el combobox (solo nombre en el label)
  const items: GAPropertyItem[] = useMemo(
    () =>
      (properties || []).map((p) => ({
        id: p.propertyId,
        label: p.displayName || p.propertyId, // 👈 SOLO nombre, sin " — 123"
        currencyCode: p.currencyCode || null,
        timeZone: p.timeZone || null,
      })),
    [properties]
  );

  return { properties, items, defaultPropertyId, loading, error };
}
