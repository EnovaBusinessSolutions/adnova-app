// dashboard-src/src/hooks/useAdminUsers.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiAdmin, buildQs, RangeParams } from "@/lib/adminApi";

type AnyObj = Record<string, any>;

export type AdminUserRow = {
  // Identidad
  userId: string;
  email?: string;
  name?: string;

  // Fechas
  createdAt?: string; // ISO (o registeredAt del backend)
  lastLoginAt?: string; // ISO

  // Selecciones / conexiones
  metaAccountId?: string;
  metaAccountName?: string;
  googleAdsCustomerId?: string;
  googleAdsAccountName?: string;
  ga4PropertyId?: string;
  ga4PropertyName?: string;

  // Métricas 30d
  metaSpend30d?: number;
  googleSpend30d?: number;
  ga4Sessions30d?: number;

  // Extra opcional
  status?: string;
  raw?: AnyObj;
};

function toStr(v: any) {
  const s = String(v ?? "").trim();
  return s || "";
}

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickFirstTruthy(...vals: any[]) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v.trim() : v;
    if (typeof s === "string" && !s) continue;
    return v;
  }
  return undefined;
}

function splitIdName(label: any): { id?: string; name?: string } {
  const s = toStr(label);
  if (!s) return {};
  const m = s.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (m) {
    const id = toStr(m[1]);
    const name = toStr(m[2]);
    return { id: id || undefined, name: name || undefined };
  }
  return { id: s || undefined, name: undefined };
}

function normMetaId(v: any) {
  const s = toStr(v).replace(/^act_/, "");
  return s || undefined;
}

function normGoogleCustomerId(v: any) {
  const s = toStr(v)
    .replace(/^customers\//, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "");
  return s || undefined;
}

function normGa4PropertyId(v: any) {
  const s = toStr(v);
  if (!s) return undefined;
  if (/^properties\/\d+$/.test(s)) return s;
  const digits = s.replace(/[^\d]/g, "");
  return digits ? `properties/${digits}` : undefined;
}

/**
 * Extrae fecha “de orden” robusta.
 * - prioridad: registeredAt/createdAt
 * - fallback: timestamp embebido en ObjectId (_id) si existe
 */
function pickOrderTs(x: AnyObj): number {
  const iso =
    toStr(
      pickFirstTruthy(
        x.registeredAt,
        x.createdAt,
        x.created_at,
        x.user?.registeredAt,
        x.user?.createdAt
      )
    ) || "";

  if (iso) {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) return t;
  }

  // fallback: ObjectId -> primeros 8 hex = timestamp (segundos)
  const oid = toStr(pickFirstTruthy(x._id, x.id, x.userId));
  const m = oid.match(/^[a-f0-9]{24}$/i);
  if (m) {
    const seconds = parseInt(oid.slice(0, 8), 16);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }

  return 0;
}

function pickRow(x: AnyObj): AdminUserRow {
  const userId =
    toStr(x.userId) ||
    toStr(x._id) ||
    toStr(x.id) ||
    toStr(x.user?._id) ||
    toStr(x.user?.id) ||
    "—";

  const email =
    toStr(pickFirstTruthy(x.email, x.user?.email, x.emails?.[0]?.value)) ||
    undefined;

  const name =
    toStr(pickFirstTruthy(x.name, x.user?.name, x.fullName, x.displayName)) ||
    undefined;

  // ✅ FECHAS (soporta registeredAt)
  const createdAt =
    toStr(
      pickFirstTruthy(
        x.registeredAt,
        x.createdAt,
        x.created_at,
        x.user?.registeredAt,
        x.user?.createdAt
      )
    ) || undefined;

  const lastLoginAt =
    toStr(
      pickFirstTruthy(
        x.lastLoginAt,
        x.lastLogin,
        x.user?.lastLoginAt,
        x.user?.lastLogin,
        x.last_login_at
      )
    ) || undefined;

  // META
  const metaSelected = splitIdName(x.metaAccountSelected);
  const metaAccountId =
    normMetaId(
      pickFirstTruthy(
        x.metaAccountId,
        x.meta?.selectedAccountId,
        x.meta?.accountId,
        x.meta?.selectedAccountIds?.[0],
        x.meta?.accountIds?.[0],
        metaSelected.id
      )
    ) || undefined;

  const metaAccountName =
    toStr(
      pickFirstTruthy(
        x.metaAccountName,
        x.meta?.selectedAccountName,
        x.meta?.accountName,
        x.meta?.name,
        metaSelected.name
      )
    ) || undefined;

  // GOOGLE ADS
  const googleSelected = splitIdName(x.googleAdsAccount);
  const googleAdsCustomerId =
    normGoogleCustomerId(
      pickFirstTruthy(
        x.googleAdsCustomerId,
        x.googleAds?.selectedCustomerId,
        x.googleAds?.customerId,
        x.googleAds?.selectedCustomerIds?.[0],
        x.googleAds?.customerIds?.[0],
        x.selectedCustomerId,
        x.selectedCustomerIds?.[0],
        googleSelected.id
      )
    ) || undefined;

  const googleAdsAccountName =
    toStr(
      pickFirstTruthy(
        x.googleAdsAccountName,
        x.googleAds?.selectedAccountName,
        x.googleAds?.accountName,
        x.googleAds?.name,
        x.selectedCustomerName,
        googleSelected.name
      )
    ) || undefined;

  // GA4
  const ga4Selected = splitIdName(x.ga4Account);
  const ga4PropertyId =
    normGa4PropertyId(
      pickFirstTruthy(
        x.ga4PropertyId,
        x.ga4?.selectedPropertyId,
        x.ga4?.propertyId,
        x.selectedPropertyId,
        x.selectedPropertyIds?.[0],
        x.defaultPropertyId,
        ga4Selected.id
      )
    ) || undefined;

  const ga4PropertyName =
    toStr(
      pickFirstTruthy(
        x.ga4PropertyName,
        x.ga4?.selectedPropertyName,
        x.ga4?.propertyName,
        x.ga4?.name,
        x.defaultPropertyName,
        x.selectedPropertyName,
        ga4Selected.name
      )
    ) || undefined;

  // MÉTRICAS
  const metaSpend30d = num(
    pickFirstTruthy(x.metaSpend30d, x.meta?.spend30d, x.metaSpend30D)
  );
  const googleSpend30d = num(
    pickFirstTruthy(x.googleSpend30d, x.googleAds?.spend30d, x.googleSpend30D)
  );
  const ga4Sessions30d = num(
    pickFirstTruthy(
      x.ga4Sessions30d,
      x.ga4?.sessions30d,
      x.gaSessions30d,
      x.gaSessions30D
    )
  );

  const status = toStr(pickFirstTruthy(x.status, x.user?.status)) || undefined;

  return {
    userId,
    email,
    name,
    createdAt,
    lastLoginAt,
    metaAccountId,
    metaAccountName,
    googleAdsCustomerId,
    googleAdsAccountName,
    ga4PropertyId,
    ga4PropertyName,
    metaSpend30d,
    googleSpend30d,
    ga4Sessions30d,
    status,
    raw: x,
  };
}

function safeIsoToLocale(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX");
}

function dedupeByUserId(list: AdminUserRow[]) {
  const seen = new Set<string>();
  const out: AdminUserRow[] = [];
  for (const it of list) {
    const k = String(it.userId || "");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function sortNewestFirst(list: AdminUserRow[]) {
  const ts = (it: AdminUserRow) => {
    const iso = it.createdAt || "";
    const t = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(t)) return t as number;
    // fallback: ObjectId timestamp
    const oid = String(it.userId || "");
    const m = oid.match(/^[a-f0-9]{24}$/i);
    if (m) return parseInt(oid.slice(0, 8), 16) * 1000;
    return 0;
  };
  return [...list].sort((a, b) => ts(b) - ts(a));
}

export function useAdminUsers(opts: {
  token: string;
  range?: RangeParams; // ✅ compat: el componente puede pasarlo, pero NO filtramos users por rango
  initialLimit?: number;
}) {
  const { token, initialLimit = 50 } = opts;

  const [items, setItems] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [limit, setLimit] = useState<number>(initialLimit);

  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Anti race-condition
  const reqIdRef = useRef(0);

  const reset = useCallback(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setErr(null);
  }, []);

  const load = useCallback(
    async (params?: { reset?: boolean }) => {
      const resetMode = !!params?.reset;

      const reqId = ++reqIdRef.current;
      setLoading(true);
      setErr(null);

      // ✅ reset REAL antes de pedir (evita mezclar páginas)
      if (resetMode) {
        setItems([]);
        setCursor(null);
        setHasMore(false);
      }

      try {
        // ✅ IMPORTANTE:
        // NO mandamos from/to aquí porque eso “desaparece” usuarios reales si backend filtra por createdAt.
        const qs = buildQs({
          q: q || undefined,
          limit,
          cursor: resetMode ? undefined : cursor || undefined,

          // cache-buster: evita respuestas viejas en proxys/edge
          t: Date.now(),
        });

        const d = await apiAdmin(`/users${qs}`, token);

        if (reqId !== reqIdRef.current) return;

        const rawItems = Array.isArray(d?.items) ? d.items : [];
        const nextCursor = d?.nextCursor ? String(d.nextCursor) : null;

        // map robusto
        const mapped = rawItems.map((x: AnyObj) => pickRow(x));

        // ✅ merge + dedupe + sort newest first
        setItems((prev) => {
          const merged = resetMode ? mapped : [...prev, ...mapped];
          return sortNewestFirst(dedupeByUserId(merged));
        });

        setCursor(nextCursor);
        setHasMore(!!nextCursor && rawItems.length > 0);
      } catch (e: any) {
        if (reqId !== reqIdRef.current) return;
        setErr(e?.message || "USERS_ERROR");
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    },
    [token, q, limit, cursor]
  );

  // Auto reload cuando cambia token
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const refresh = useCallback(() => {
    load({ reset: true });
  }, [load]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    load({ reset: false });
  }, [load, loading, hasMore]);

  // Totales
  const metaSpendTotal = useMemo(
    () => items.reduce((a, b) => a + (b.metaSpend30d || 0), 0),
    [items]
  );
  const googleSpendTotal = useMemo(
    () => items.reduce((a, b) => a + (b.googleSpend30d || 0), 0),
    [items]
  );
  const sessionsTotal = useMemo(
    () => items.reduce((a, b) => a + (b.ga4Sessions30d || 0), 0),
    [items]
  );

  return {
    items,
    loading,
    err,

    q,
    setQ,
    limit,
    setLimit,

    cursor,
    hasMore,

    reset,
    refresh,
    loadMore,
    load,

    safeIsoToLocale,
    metaSpendTotal,
    googleSpendTotal,
    sessionsTotal,
  };
}
