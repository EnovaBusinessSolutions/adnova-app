import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PlatformKey = "meta" | "googleAds" | "ga4" | "shopify";

type PlatformStatus = {
  connected: boolean;

  // 🔥 claves para selector/flujo
  availableCount?: number;
  selectedCount?: number;
  requiredSelection?: boolean;

  // opcionales para UI/redirect
  selected?: string[];
  maxSelect?: number;

  // defaults por plataforma
  defaultAccountId?: string | null;   // meta
  defaultCustomerId?: string | null;  // googleAds
  defaultPropertyId?: string | null;  // ga4

  // info extra
  adsScopeOk?: boolean;
  gaScopeOk?: boolean;

  // legacy
  count?: number;
};

export type OnboardingStatusResponse = {
  ok: boolean;
  status: {
    meta: PlatformStatus;
    googleAds: PlatformStatus;
    ga4: PlatformStatus;
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

function normalizePlatform(raw: any): PlatformStatus {
  const o = raw || {};
  return {
    connected: !!o.connected,

    // soporta ambos nombres por compat
    availableCount:
      typeof o.availableCount === "number"
        ? o.availableCount
        : typeof o.count === "number"
          ? o.count
          : undefined,

    selectedCount: typeof o.selectedCount === "number" ? o.selectedCount : undefined,
    requiredSelection: typeof o.requiredSelection === "boolean" ? o.requiredSelection : undefined,

    selected: Array.isArray(o.selected) ? o.selected.filter(Boolean) : undefined,
    maxSelect: typeof o.maxSelect === "number" ? o.maxSelect : undefined,

    defaultAccountId: o.defaultAccountId ?? null,
    defaultCustomerId: o.defaultCustomerId ?? null,
    defaultPropertyId: o.defaultPropertyId ?? null,

    adsScopeOk: typeof o.adsScopeOk === "boolean" ? o.adsScopeOk : undefined,
    gaScopeOk: typeof o.gaScopeOk === "boolean" ? o.gaScopeOk : undefined,

    count: typeof o.count === "number" ? o.count : undefined,
  };
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
      meta: normalizePlatform(st?.meta),
      googleAds: normalizePlatform(st?.googleAds),
      ga4: normalizePlatform(st?.ga4),
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
        if (!hasLoadedOnceRef.current) setData(null);
        setError("Respuesta inesperada en /api/onboarding/status");
      }
    } catch (e: any) {
      if (!hasLoadedOnceRef.current) setData(null);
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

  // ✅ READY = tenemos status confiable
  const ready = useMemo(() => !!data?.status, [data]);

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

  // ✅ AHORA sí viene del backend
  const requiredSelection = useMemo(() => {
    const st = data?.status;
    return {
      meta: !!st?.meta?.requiredSelection,
      googleAds: !!st?.googleAds?.requiredSelection,
      ga4: !!st?.ga4?.requiredSelection,
    };
  }, [data]);

  const selectionMaxRule = useMemo(() => Number(data?.rules?.selectionMaxRule || 1), [data]);

  // ✅ helper real
  const needsSelectionFor = useCallback(
    (k: Exclude<PlatformKey, "shopify">) => {
      const st = data?.status as any;
      if (!st) return false;
      const p = st?.[k];
      return !!(p?.connected && p?.requiredSelection);
    },
    [data]
  );

  return {
    data,
    loading,
    refreshing,
    ready,
    error,
    refresh,
    connected,

    requiredSelection,
    selectionMaxRule,
    needsSelectionFor,
  };
}

export default useOnboardingStatus;