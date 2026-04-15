import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AnyObj = Record<string, any>;

async function apiJson(input: RequestInfo, init?: RequestInit) {
  try {
    const r = await fetch(input, {
      credentials: "include",
      headers: { Accept: "application/json" },
      ...init,
    });

    const json = await r.json().catch(() => ({}));
    return (json?.data ?? json) as AnyObj;
  } catch {
    return {} as AnyObj;
  }
}

function isTruthy(v: any) {
  return v === true || v === "true" || v === 1 || v === "1";
}

// ------------------------------
// Local flags (POR USUARIO) + LEGACY SAFE (por sesión)
// ------------------------------
function safeLSGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeLSSet(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {}
}
function safeLSRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

/**
 * ✅ NO "anon".
 * Si no hay userKey => no hay key scoped => no hay flags scoped.
 */
function userScopedKey(userKey: string | null, rawKey: string) {
  if (!userKey) return null;
  return `adray:${String(userKey)}:${rawKey}`;
}

// keys viejas que podrían existir
function legacyKey(rawKey: string) {
  switch (rawKey) {
    case "pixel_audit_done":
      return "adray_pixel_audit_done";
    case "first_audit_started":
      return "adray_first_audit_started";
    case "audits_seen":
      return "adray_audits_seen";
    default:
      return `adray_${rawKey}`;
  }
}

function legacyAtKey(rawKey: string) {
  switch (rawKey) {
    case "pixel_audit_done":
      return "adray_pixel_audit_done_at";
    case "first_audit_started":
      return "adray_first_audit_started_at";
    case "audits_seen":
      return "adray_audits_seen_at";
    default:
      return `adray_${rawKey}_at`;
  }
}

function readFlagScoped(userKey: string | null, rawKey: string) {
  const k = userScopedKey(userKey, rawKey);
  if (!k) return false;
  return safeLSGet(k) === "1";
}

/**
 * ✅ Legacy SOLO si se escribió durante la sesión actual.
 * Requiere que exista key legacy = "1" y legacy_at = timestamp >= sessionStartedAt
 */
function readLegacyIfThisSession(rawKey: "pixel_audit_done" | "first_audit_started" | "audits_seen", sessionStartedAt: number) {
  const done = safeLSGet(legacyKey(rawKey)) === "1";
  if (!done) return false;

  const atRaw = safeLSGet(legacyAtKey(rawKey));
  const at = atRaw ? Number(atRaw) : 0;
  if (!Number.isFinite(at) || at <= 0) return false;

  return at >= sessionStartedAt;
}

function migrateLegacyToScoped(
  userKey: string | null,
  rawKey: "pixel_audit_done" | "first_audit_started" | "audits_seen",
  sessionStartedAt: number
) {
  const scoped = userScopedKey(userKey, rawKey);
  if (!scoped) return;

  // Si ya está en scoped, no hagas nada
  if (safeLSGet(scoped) === "1") return;

  if (!readLegacyIfThisSession(rawKey, sessionStartedAt)) return;

  // Migra a scoped
  safeLSSet(scoped, "1");

  // Limpia legacy para evitar contaminación futura
  safeLSRemove(legacyKey(rawKey));
  safeLSRemove(legacyAtKey(rawKey));
}

// ---- Pixel (mantiene tu lógica, pero ahora usa helpers genéricos) ----
function readPixelAuditDone(userKey: string | null, sessionStartedAt: number) {
  // 1) scoped manda
  if (readFlagScoped(userKey, "pixel_audit_done")) return true;

  // 2) legacy SOLO si ocurrió en esta sesión (y entonces migramos)
  if (userKey && readLegacyIfThisSession("pixel_audit_done", sessionStartedAt)) {
    migrateLegacyToScoped(userKey, "pixel_audit_done", sessionStartedAt);
    return true;
  }

  return false;
}

// ✅ Ahora también soporta legacy “solo si en esta sesión” (para evitar multiusuario)
function readFirstAuditStarted(userKey: string | null, sessionStartedAt: number) {
  // 1) scoped manda
  if (readFlagScoped(userKey, "first_audit_started")) return true;

  // 2) legacy SOLO si ocurrió en esta sesión
  if (readLegacyIfThisSession("first_audit_started", sessionStartedAt)) {
    // si ya hay userKey, migra para que quede limpio/scoped
    if (userKey) migrateLegacyToScoped(userKey, "first_audit_started", sessionStartedAt);
    return true;
  }

  return false;
}

function readAuditsSeen(userKey: string | null, sessionStartedAt: number) {
  // 1) scoped manda
  if (readFlagScoped(userKey, "audits_seen")) return true;

  // 2) legacy SOLO si ocurrió en esta sesión
  if (readLegacyIfThisSession("audits_seen", sessionStartedAt)) {
    if (userKey) migrateLegacyToScoped(userKey, "audits_seen", sessionStartedAt);
    return true;
  }

  return false;
}

// ------------------------------
// Heurísticas robustas por fuente (AFINADAS)
// ------------------------------
function pickMetaConnected(s: AnyObj) {
  return (
    isTruthy(s?.metaConnected) ||
    isTruthy(s?.meta?.connected) ||
    isTruthy(s?.meta?.isConnected) ||
    isTruthy(s?.meta?.ready) ||
    (Array.isArray(s?.meta?.adAccounts) && s.meta.adAccounts.length > 0) ||
    (Array.isArray(s?.metaAccounts) && s.metaAccounts.length > 0)
  );
}

function pickGoogleAdsConnected(s: AnyObj) {
  const accounts = s?.googleAdsAccounts ?? s?.google?.adsAccounts ?? s?.google_ads?.accounts;
  const hasAccounts = Array.isArray(accounts) ? accounts.length > 0 : false;

  return (
    isTruthy(s?.googleAdsConnected) ||
    isTruthy(s?.googleAds?.connected) ||
    isTruthy(s?.google_ads?.connected) ||
    isTruthy(s?.google?.adsConnected) ||
    hasAccounts
  );
}

function pickGA4Connected(s: AnyObj) {
  const selected =
    s?.selectedPropertyIds ??
    s?.googleAccount?.selectedPropertyIds ??
    s?.ga?.selectedPropertyIds ??
    s?.user?.selectedGAProperties ??
    s?.selectedGAProperties;

  const defaultPid =
    s?.defaultPropertyId ??
    s?.googleAccount?.defaultPropertyId ??
    s?.ga?.defaultPropertyId ??
    s?.user?.defaultPropertyId;

  const props =
    s?.gaProperties ??
    s?.googleAccount?.gaProperties ??
    s?.properties ??
    s?.ga?.properties;

  const hasSelection = Array.isArray(selected) ? selected.length > 0 : false;
  const hasDefault = !!defaultPid;
  const hasProps = Array.isArray(props) ? props.length > 0 : false;

  return (
    hasSelection ||
    hasDefault ||
    isTruthy(s?.ga4Connected) ||
    isTruthy(s?.ga?.connected) ||
    isTruthy(s?.googleAnalyticsConnected) ||
    (hasProps && Array.isArray(props) && props.length === 1)
  );
}

function pickGoogleConnected(s: AnyObj) {
  const direct =
    isTruthy(s?.googleConnected) ||
    isTruthy(s?.google?.connected) ||
    isTruthy(s?.google?.isConnected) ||
    isTruthy(s?.googleReady) ||
    isTruthy(s?.authGoogleConnected) ||
    isTruthy(s?.hasGoogleToken) ||
    isTruthy(s?.hasRefreshToken) ||
    isTruthy(s?.google?.hasRefreshToken) ||
    isTruthy(s?.google?.hasToken) ||
    isTruthy(s?.google?.authorized);

  if (direct) return true;

  return pickGoogleAdsConnected(s) || pickGA4Connected(s);
}

function pickShopifyConnected(s: AnyObj) {
  return (
    isTruthy(s?.shopifyConnected) ||
    isTruthy(s?.shopify?.connected) ||
    isTruthy(s?.shopify?.isConnected) ||
    !!s?.shopify?.shop ||
    !!s?.shopifyShop ||
    !!s?.shop ||
    (Array.isArray(s?.shops) && s.shops.length > 0)
  );
}

export type GettingStartedStatus = {
  loading: boolean;

  // Identidad
  userKey: string | null;

  metaConnected: boolean;
  googleConnected: boolean;

  // compat
  googleAdsConnected: boolean;
  ga4Connected: boolean;

  shopifyConnected: boolean;
  siteConnected: boolean;

  // flags “soft” por usuario
  pixelAuditDone: boolean;
  firstAuditStarted: boolean;
  auditsVisited: boolean;

  // progreso legacy (3 pasos)
  completed: number;
  total: number;
  pct: number;

  refresh: () => Promise<void>;
};

export function useGettingStartedProgress(): GettingStartedStatus {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AnyObj>({});

  const [userKey, setUserKey] = useState<string | null>(null);

  // ✅ momento en el que se “establece” la sesión del usuario actual
  const sessionStartedAtRef = useRef<number>(Date.now());

  const [pixelAuditDone, setPixelAuditDone] = useState(false);
  const [firstAuditStarted, setFirstAuditStarted] = useState(false);
  const [auditsVisited, setAuditsVisited] = useState(false);

  const recomputeFlags = useCallback(
    (u: string | null) => {
      const sessionStartedAt = sessionStartedAtRef.current;

      setPixelAuditDone(readPixelAuditDone(u, sessionStartedAt));
      setFirstAuditStarted(readFirstAuditStarted(u, sessionStartedAt));
      setAuditsVisited(readAuditsSeen(u, sessionStartedAt));
    },
    []
  );

  // Cuando cambia userKey: reevalúa flags (con legacy seguro)
  useEffect(() => {
    recomputeFlags(userKey);
  }, [userKey, recomputeFlags]);

  const refresh = useCallback(async () => {
    setLoading(true);

    const [me, sOnboarding, sGoogle, sMeta, sMetaAccounts, sShopifyA, sShopifyB] =
      await Promise.all([
        apiJson("/api/auth/me"),
        apiJson("/api/onboarding/status"),
        apiJson("/auth/google/status"),
        apiJson("/auth/meta/status"),
        apiJson("/auth/meta/accounts"),
        apiJson("/auth/shopify/status"),
        apiJson("/api/shopify/status"),
      ]);

    const nextUserKey =
      (me?._id && String(me._id)) ||
      (me?.id && String(me.id)) ||
      (me?.email && String(me.email)) ||
      null;

    // ✅ Si cambió de usuario (login/logout/login), reinicia “sessionStartedAt”
    if (nextUserKey !== userKey) {
      sessionStartedAtRef.current = Date.now();
    }

    setUserKey(nextUserKey);

    // ✅ Migra legacy -> scoped (solo si fue en esta sesión) para los 3 flags
    if (nextUserKey) {
      migrateLegacyToScoped(nextUserKey, "pixel_audit_done", sessionStartedAtRef.current);
      migrateLegacyToScoped(nextUserKey, "first_audit_started", sessionStartedAtRef.current);
      migrateLegacyToScoped(nextUserKey, "audits_seen", sessionStartedAtRef.current);
    }

    const metaAccounts =
      sMetaAccounts?.accounts ??
      sMetaAccounts?.data?.accounts ??
      sMetaAccounts?.data ??
      sMetaAccounts;

    const merged: AnyObj = {
      ...(sOnboarding || {}),
      ...(sGoogle || {}),
      ...(sMeta || {}),
      metaAccounts: Array.isArray(metaAccounts) ? metaAccounts : [],
      shopify: { ...(sShopifyA || {}), ...(sShopifyB || {}) },
      shopifyConnected:
        isTruthy(sOnboarding?.shopifyConnected) ||
        isTruthy(sShopifyA?.connected) ||
        isTruthy(sShopifyB?.connected),
    };

    setStatus(merged);

    // ✅ Recalcula flags ya con userKey correcto
    recomputeFlags(nextUserKey);

    setLoading(false);
  }, [recomputeFlags, userKey]);

  useEffect(() => {
    let alive = true;

    (async () => {
      await refresh();
      if (!alive) return;
    })();

    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onFocus = () => refresh();

    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;

      // scoped keys (si hay userKey)
      const s1 = userScopedKey(userKey, "pixel_audit_done");
      const s2 = userScopedKey(userKey, "first_audit_started");
      const s3 = userScopedKey(userKey, "audits_seen");

      // legacy keys + _at
      const l1 = legacyKey("pixel_audit_done");
      const l1at = legacyAtKey("pixel_audit_done");
      const l2 = legacyKey("first_audit_started");
      const l2at = legacyAtKey("first_audit_started");
      const l3 = legacyKey("audits_seen");
      const l3at = legacyAtKey("audits_seen");

      const touched =
        (s1 && e.key === s1) ||
        (s2 && e.key === s2) ||
        (s3 && e.key === s3) ||
        e.key === l1 ||
        e.key === l1at ||
        e.key === l2 ||
        e.key === l2at ||
        e.key === l3 ||
        e.key === l3at;

      if (!touched) return;

      // Migra legacy -> scoped si corresponde a esta sesión
      if (userKey) {
        migrateLegacyToScoped(userKey, "pixel_audit_done", sessionStartedAtRef.current);
        migrateLegacyToScoped(userKey, "first_audit_started", sessionStartedAtRef.current);
        migrateLegacyToScoped(userKey, "audits_seen", sessionStartedAtRef.current);
      }

      recomputeFlags(userKey);
    };

    // ✅ Evento custom para MISMO TAB (PixelChecker / GenerateAudit lo disparan)
    const onGsUpdated = () => {
      if (userKey) {
        migrateLegacyToScoped(userKey, "pixel_audit_done", sessionStartedAtRef.current);
        migrateLegacyToScoped(userKey, "first_audit_started", sessionStartedAtRef.current);
        migrateLegacyToScoped(userKey, "audits_seen", sessionStartedAtRef.current);
      }
      recomputeFlags(userKey);
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    window.addEventListener("adray:gs-flags-updated", onGsUpdated as EventListener);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("adray:gs-flags-updated", onGsUpdated as EventListener);
    };
  }, [refresh, userKey, recomputeFlags]);

  const metaConnected = useMemo(() => pickMetaConnected(status), [status]);
  const googleConnected = useMemo(() => pickGoogleConnected(status), [status]);

  const googleAdsConnected = useMemo(() => googleConnected, [googleConnected]);
  const ga4Connected = useMemo(() => googleConnected, [googleConnected]);

  const shopifyConnected = useMemo(() => pickShopifyConnected(status), [status]);

  const siteConnected = useMemo(() => {
    const url =
      status?.siteUrl ??
      status?.website ??
      status?.user?.siteUrl ??
      status?.user?.website ??
      status?.profile?.website;
    return typeof url === "string" && url.trim().length > 0;
  }, [status]);

  // ✅ Regla: Paso 5 NO cuenta si paso 4 no está hecho
  const auditsVisitedEffective = firstAuditStarted ? auditsVisited : false;

  // progreso legacy (3 pasos)
  const total = 3;
  const completed = useMemo(() => {
    const steps = [pixelAuditDone, metaConnected, googleConnected];
    return steps.filter(Boolean).length;
  }, [pixelAuditDone, metaConnected, googleConnected]);

  const pct = useMemo(() => {
    if (!total) return 0;
    return Math.round((completed / total) * 100);
  }, [completed, total]);

  return {
    loading,
    userKey,

    metaConnected,
    googleConnected,
    googleAdsConnected,
    ga4Connected,

    shopifyConnected,
    siteConnected,

    pixelAuditDone,
    firstAuditStarted,
    auditsVisited: auditsVisitedEffective,

    completed,
    total,
    pct,

    refresh,
  };
}
