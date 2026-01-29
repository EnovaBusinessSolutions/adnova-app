import { useEffect, useMemo, useState } from "react";

type AnyObj = Record<string, any>;

function apiJson(input: RequestInfo, init?: RequestInit) {
  return fetch(input, { credentials: "include", ...init })
    .then(async (r) => {
      const json = await r.json().catch(() => ({}));
      return (json?.data ?? json) as AnyObj; // soporta {ok:true,data:{...}} y payload plano
    })
    .catch(() => ({} as AnyObj));
}

function isTruthy(v: any) {
  return v === true || v === "true" || v === 1 || v === "1";
}

// Heurísticas robustas para distintos shapes
function pickMetaConnected(s: AnyObj) {
  return (
    isTruthy(s?.metaConnected) ||
    isTruthy(s?.meta?.connected) ||
    isTruthy(s?.meta?.isConnected) ||
    (Array.isArray(s?.meta?.adAccounts) && s.meta.adAccounts.length > 0) ||
    (Array.isArray(s?.metaAccounts) && s.metaAccounts.length > 0)
  );
}
function pickGoogleAdsConnected(s: AnyObj) {
  return (
    isTruthy(s?.googleAdsConnected) ||
    isTruthy(s?.googleAds?.connected) ||
    isTruthy(s?.google_ads?.connected) ||
    (Array.isArray(s?.googleAdsAccounts) && s.googleAdsAccounts.length > 0) ||
    (Array.isArray(s?.google?.adsAccounts) && s.google.adsAccounts.length > 0)
  );
}
function pickGA4Connected(s: AnyObj) {
  const selected =
    s?.selectedPropertyIds ??
    s?.googleAccount?.selectedPropertyIds ??
    s?.ga?.selectedPropertyIds ??
    s?.user?.selectedGAProperties ??
    s?.selectedGAProperties;

  // conectado si hay selección (porque ya pasaste por el selector)
  return Array.isArray(selected) ? selected.length > 0 : isTruthy(s?.ga4Connected) || isTruthy(s?.ga?.connected);
}
function pickShopifyConnected(s: AnyObj) {
  return isTruthy(s?.shopifyConnected) || isTruthy(s?.shopify?.connected);
}

// Pixel audit: por ahora “E2E local” (hasta que lo conectemos a backend).
// Cuando corras PixelChecker, guardaremos localStorage flag y fecha.
function readPixelAuditDone() {
  try {
    const v = localStorage.getItem("adray_pixel_audit_done");
    return v === "1";
  } catch {
    return false;
  }
}

export type GettingStartedStatus = {
  loading: boolean;
  metaConnected: boolean;
  googleAdsConnected: boolean;
  ga4Connected: boolean;
  shopifyConnected: boolean;
  pixelAuditDone: boolean;
  completed: number;
  total: number;
  pct: number;
};

export function useGettingStartedProgress(): GettingStartedStatus {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AnyObj>({});
  const [pixelAuditDone, setPixelAuditDone] = useState(readPixelAuditDone());

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);

      // 1) intentamos onboarding/status (si existe)
      const s1 = await apiJson("/api/onboarding/status");

      // 2) fallback: google status (ya lo usas en onboarding / settings)
      const s2 = await apiJson("/auth/google/status");

      // 3) fallback: meta status/accounts
      const s3 = await apiJson("/auth/meta/status");
      const s4 = await apiJson("/auth/meta/accounts");

      const merged = { ...(s1 || {}), ...(s2 || {}), ...(s3 || {}), metaAccounts: s4?.accounts ?? s4?.data ?? s4 };

      if (!alive) return;

      setStatus(merged);
      setPixelAuditDone(readPixelAuditDone());
      setLoading(false);
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  const metaConnected = useMemo(() => pickMetaConnected(status), [status]);
  const googleAdsConnected = useMemo(() => pickGoogleAdsConnected(status), [status]);
  const ga4Connected = useMemo(() => pickGA4Connected(status), [status]);
  const shopifyConnected = useMemo(() => pickShopifyConnected(status), [status]);

  // Total “setup steps” (ajustable)
  const total = 6;

  const completed = useMemo(() => {
    const steps = [
      pixelAuditDone,
      metaConnected,
      googleAdsConnected,
      ga4Connected,
      false, // Sitio Web (cuando exista)
      shopifyConnected, // Shopify (cuando exista)
    ];
    return steps.filter(Boolean).length;
  }, [pixelAuditDone, metaConnected, googleAdsConnected, ga4Connected, shopifyConnected]);

  const pct = useMemo(() => Math.round((completed / total) * 100), [completed]);

  return {
    loading,
    metaConnected,
    googleAdsConnected,
    ga4Connected,
    shopifyConnected,
    pixelAuditDone,
    completed,
    total,
    pct,
  };
}
