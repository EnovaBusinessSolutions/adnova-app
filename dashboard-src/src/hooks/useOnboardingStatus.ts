import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PlatformKey = "meta" | "googleAds" | "ga4" | "shopify";

export type OnboardingStatusResponse = {
  ok: boolean;
  status: {
    meta: { connected: boolean };
    googleAds: { connected: boolean };
    ga4: { connected: boolean };
    shopify: { connected: boolean };
    // legacy (compat)
    google?: { connected?: boolean; count?: number };
  };
  sourcesToAnalyze?: string[];
  rules?: { selectionMaxRule?: number };
};

async function apiJson<T>(url: string, signal?: AbortSignal) {
  const r = await fetch(url, { credentials: "include", signal });
  const txt = await r.text();
  if (!r.ok) throw new Error(txt || `HTTP ${r.status}`);
  return JSON.parse(txt) as T;
}

function normalizeStatus(raw: any): OnboardingStatusResponse | null {
  if (!raw) return null;

  // Soporta {ok:true, data:{...}} o payload plano
  const payload = raw?.data ?? raw;

  const st = payload?.status;
  if (!st) return null;

  return {
    ok: payload?.ok !== false,
    status: {
      meta: { connected: !!st?.meta?.connected },
      googleAds: { connected: !!st?.googleAds?.connected },
      ga4: { connected: !!st?.ga4?.connected },
      shopify: { connected: !!st?.shopify?.connected },
      google: st?.google,
    },
    sourcesToAnalyze: payload?.sourcesToAnalyze,
    rules: payload?.rules,
  };
}

export function useOnboardingStatus(opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled !== false;

  const [data, setData] = useState<OnboardingStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true); // solo para primer load
  const [refreshing, setRefreshing] = useState<boolean>(false); // para refetch sin parpadeos
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    abortRef.current?.abort?.();
    const ac = new AbortController();
    abortRef.current = ac;

    // Importante: si ya cargamos antes, NO activamos loading global (evita flicker)
    if (!hasLoadedOnceRef.current) setLoading(true);
    else setRefreshing(true);

    setError(null);

    try {
      const raw = await apiJson<any>("/api/onboarding/status", ac.signal);
      const normalized = normalizeStatus(raw);

      if (normalized) {
        setData(normalized);
        hasLoadedOnceRef.current = true;
      } else {
        // Si vino un shape inesperado, no tiramos la UI: mantenemos el último estado si existe
        if (!hasLoadedOnceRef.current) setData(null);
        setError("Respuesta inesperada en /api/onboarding/status");
      }
    } catch (e: any) {
      // CLAVE anti-flicker:
      // - Si ya teníamos data, la conservamos (no ponemos data=null)
      // - Si nunca cargó, dejamos data null y mantenemos loading->false al final
      if (!hasLoadedOnceRef.current) {
        setData(null);
      }
      setError(e?.message || "No se pudo cargar el estado de integraciones");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort?.();
  }, [refresh]);

  // ✅ READY = tenemos status confiable (evita “micropantallazos”)
  const ready = useMemo(() => {
    return !!data?.status;
  }, [data]);

  const connected = useMemo(() => {
    const st = data?.status;
    return {
      meta: !!st?.meta?.connected,
      googleAds: !!st?.googleAds?.connected,
      ga4: !!st?.ga4?.connected,
      shopify: !!st?.shopify?.connected,
      googleAny: !!(st?.googleAds?.connected || st?.ga4?.connected),
    };
  }, [data]);

  // 👇 Dejamos esto por compat, pero YA NO lo usamos en el dashboard
  const requiredSelection = useMemo(() => {
    return { meta: false, googleAds: false, ga4: false };
  }, []);

  const selectionMaxRule = useMemo(() => Number(data?.rules?.selectionMaxRule || 1), [data]);

  const needsSelectionFor = useCallback((_k: Exclude<PlatformKey, "shopify">) => false, []);

  return {
    data,
    loading,
    refreshing,
    ready,
    error,
    refresh,
    connected,

    // compat (pero apagado)
    requiredSelection,
    selectionMaxRule,
    needsSelectionFor,
  };
}

export default useOnboardingStatus;
