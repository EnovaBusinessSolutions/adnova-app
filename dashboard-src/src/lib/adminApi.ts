// dashboard-src/src/lib/adminApi.ts

export type AnyObj = Record<string, any>;

// ✅ sessionStorage (se borra al cerrar navegador)
export const SS_KEY = "adray_internal_admin_token";

/**
 * ✅ Presets soportados en UI:
 * - today  => últimas 24 horas (ISO con hora) -> usa fromTs/toTs
 * - 30d    => últimos 30 días (YYYY-MM-DD)     -> usa from/to + cutoffDay
 */
export type RangePreset = "today" | "30d";

/**
 * ✅ DateRange (CANÓNICO para el panel interno / tabla CRM)
 * - SIEMPRE rango por día (YYYY-MM-DD)
 * - cutoffDay (YYYY-MM-DD) para congelar números por corte diario
 * - includeToday: para permitir modo “realtime” (día en curso) sin romper cierre diario
 */
export type DateRange = {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  preset: RangePreset;
  cutoffDay: string; // YYYY-MM-DD
  includeToday?: boolean;
};

/**
 * RangeParams:
 * - Para today: fromTs/toTs (ISO completo con hora)
 * - Para 30d: from/to (YYYY-MM-DD)
 * - cutoffDay: YYYY-MM-DD (día de corte, interpretado por backend)
 * - includeToday: 1/true -> permite “realtime” (día en curso) en summary/series/events/funnel
 */
export type RangeParams = {
  from?: string;
  to?: string;
  fromTs?: string;
  toTs?: string;
  cutoffDay?: string;
  includeToday?: string | boolean;
};

/** YYYY-MM-DD (local) */
export function isoDay(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** ISO seguro (Date -> ISO) */
export function isoDateTime(d: Date) {
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? "" : dt.toISOString();
}

/**
 * ✅ Rango "HOY" real (últimas 24 horas)
 * - fromTs = now - 24h
 * - toTs   = now
 */
export function makeLast24hRange(nowInput?: Date): RangeParams {
  const now = nowInput instanceof Date ? nowInput : new Date();
  const to = new Date(now.getTime());
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return { fromTs: isoDateTime(from), toTs: isoDateTime(to) };
}

/**
 * ✅ Rango por preset
 * - today: últimas 24 horas (fromTs/toTs)
 * - 30d: día local normalizado (from/to en YYYY-MM-DD) + cutoffDay=to
 *
 * Importante:
 * - “30d” = hoy + 29 días hacia atrás (incluyendo hoy)
 */
export function makeRangePreset(preset: RangePreset): RangeParams {
  if (preset === "today") {
    // Nota: forzaremos cutoffDay en la capa de endpoints del panel si no viene.
    return makeLast24hRange();
  }

  const now = new Date();
  const days = 30;

  // ✅ incluir hoy como día 1 (30d => resta 29)
  const backDays = Math.max(0, days - 1);
  const from = new Date(now.getTime() - backDays * 24 * 60 * 60 * 1000);

  // Normalizamos a "día"
  const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const fromStr = isoDay(fromDay);
  const toStr = isoDay(toDay);

  // ✅ cutoffDay SIEMPRE = to (HOY). El backend clamp a NOW si includeToday=1.
  return { from: fromStr, to: toStr, cutoffDay: toStr };
}

/** Querystring builder (robusto + permite arrays) */
export function buildQs(params: Record<string, any>) {
  const qs = new URLSearchParams();

  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;

    // arrays: foo=a&foo=b
    if (Array.isArray(v)) {
      v.forEach((it) => {
        if (it === undefined || it === null) return;
        const s = String(it).trim();
        if (!s) return;
        qs.append(k, s);
      });
      return;
    }

    const s = String(v).trim();
    if (!s) return;
    qs.set(k, s);
  });

  const out = qs.toString();
  return out ? `?${out}` : "";
}

function isTruthy(v: any) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "on";
}

/**
 * ✅ Adjunta rango canónico a cualquier set de params
 * - today: fromTs/toTs (+ cutoffDay si viene)
 * - 30d: from/to + cutoffDay (si no viene, lo inferimos como "to")
 * - includeToday: si viene true/1, se manda al backend como includeToday=1
 */
export function withRange(
  params: Record<string, any>,
  presetOrRange?: RangePreset | RangeParams | DateRange | null
) {
  if (!presetOrRange) return { ...params };

  const r: RangeParams =
    typeof presetOrRange === "string"
      ? makeRangePreset(presetOrRange)
      : (presetOrRange as any);

  // Si viene fromTs/toTs -> usar eso (tiempo real)
  if (r.fromTs || r.toTs) {
    const out = { ...params };
    if (r.fromTs) out.fromTs = r.fromTs;
    if (r.toTs) out.toTs = r.toTs;

    // cutoffDay opcional también aplica a today
    if (r.cutoffDay) out.cutoffDay = r.cutoffDay;

    if (r.includeToday !== undefined) {
      out.includeToday = isTruthy(r.includeToday) ? "1" : "0";
    }

    return out;
  }

  // Día
  const out = { ...params };
  if (r.from) out.from = r.from;
  if (r.to) out.to = r.to;

  // ✅ cutoffDay: si no viene explícito, usar "to"
  const inferredCutoff = r.cutoffDay || r.to || null;
  if (inferredCutoff) out.cutoffDay = inferredCutoff;

  if (r.includeToday !== undefined) {
    out.includeToday = isTruthy(r.includeToday) ? "1" : "0";
  }

  return out;
}

/**
 * ✅ Normaliza el rango para endpoints del panel interno:
 * - default preset: 30d
 * - default includeToday=1 (realtime)
 * - SIEMPRE garantiza cutoffDay:
 *    - si hay to -> cutoffDay=to
 *    - si no hay (ej today) -> cutoffDay=hoy (YYYY-MM-DD)
 */
function normalizePanelRange(
  range?: RangePreset | RangeParams | DateRange | null
): RangeParams {
  const todayDay = isoDay(new Date());

  const base: RangeParams =
    range == null
      ? makeRangePreset("30d")
      : typeof range === "string"
        ? makeRangePreset(range)
        : (range as any);

  const out: RangeParams = { ...base };

  // ✅ default realtime para el panel interno
  if (out.includeToday === undefined) out.includeToday = "1";

  // ✅ SIEMPRE cutoffDay para evitar que el backend caiga en "ayer"
  if (!out.cutoffDay) {
    out.cutoffDay = out.to || todayDay;
  }

  return out;
}

/**
 * Fetch wrapper para /api/admin/analytics
 */
export async function apiAdmin(
  path: string,
  token: string,
  init?: RequestInit
): Promise<AnyObj> {
  const r = await fetch(`/api/admin/analytics${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      "x-internal-admin-token": token,
      ...(init?.headers || {}),
    },
  });

  const json = await r.json().catch(() => ({} as AnyObj));
  const data = (json?.data ?? json) as AnyObj;

  if (!r.ok || (json as AnyObj)?.ok === false) {
    const msg = String(
      (json as AnyObj)?.error ||
        (json as AnyObj)?.details ||
        data?.error ||
        "UNAUTHORIZED"
    );
    throw new Error(msg);
  }

  return data;
}

/* =========================
 * ✅ Tipos por endpoint
 * ========================= */

export type AdminHealth = {
  ok?: boolean;
  env?: string;
  version?: string | null;
  db?: string;
  ts?: string;
  analyticsTz?: string;
  analyticsCollection?: string | null;
};

export type AdminSummary = {
  from?: string | null;
  to?: string | null;
  fromTs?: string | null;
  toTs?: string | null;
  swapped?: boolean;

  includeToday?: boolean;
  cutoffDay?: string | null;
  cutoffEnd?: string | null;
  cutoffEffectiveDay?: string | null;

  events?: number;
  uniqueUsers?: number;
  topEvents?: Array<{ name: string; count: number }>;
  last24hEvents?: number;
  last7dEvents?: number;
  signups?: number;

  logins?: number;
  loginsUniqueUsers?: number;

  debug?: AnyObj;
};

export type AdminEventItem = {
  id: string;
  name: string;
  userId: string | null;
  createdAt: string | null;
  props: AnyObj;
  dedupeKey: string | null;
  count?: number | null;
};

export type AdminEventsResponse = {
  items: AdminEventItem[];
  nextCursor: string | null;
  count: number;

  swapped?: boolean;
  from?: string | null;
  to?: string | null;
  fromTs?: string | null;
  toTs?: string | null;

  includeToday?: boolean;
  cutoffDay?: string | null;
  cutoffEnd?: string | null;
  cutoffEffectiveDay?: string | null;
};

export type AdminSeriesPoint = {
  bucket: string;
  count: number;
  uniqueUsers: number;
};

export type AdminSeriesResponse = {
  name: string;
  groupBy: "hour" | "day" | "week" | "month";
  from: string | null;
  to: string | null;
  fromTs?: string | null;
  toTs?: string | null;

  includeToday?: boolean;
  cutoffDay?: string | null;
  cutoffEnd?: string | null;
  cutoffEffectiveDay?: string | null;

  swapped?: boolean;
  points: AdminSeriesPoint[];
};

export type AdminFunnelRow = {
  step: string;
  index: number;
  users: number;
  dropFromPrev?: number;
  conversionFromPrev?: number;
};

export type AdminFunnelResponse = {
  from: string | null;
  to: string | null;
  fromTs?: string | null;
  toTs?: string | null;

  includeToday?: boolean;
  cutoffDay?: string | null;
  cutoffEnd?: string | null;
  cutoffEffectiveDay?: string | null;

  swapped?: boolean;
  steps: string[];
  totalUsersInWindow: number;
  funnel: AdminFunnelRow[];
};

export type AdminUserRow = {
  userId: string;
  name: string | null;
  email: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;

  metaAccountId: string | null;
  metaAccountName: string | null;
  metaSpend30d: number | null;

  googleAdsCustomerId: string | null;
  googleAdsAccountName: string | null;
  googleSpend30d: number | null;

  ga4PropertyId: string | null;
  ga4PropertyName: string | null;
  ga4Sessions30d: number | null;
};

export type AdminUsersResponse = {
  items: AdminUserRow[];
  nextCursor: string | null;
  count: number;
  swapped?: boolean;
};

/** GET /health */
export async function adminHealth(token: string) {
  return (await apiAdmin(`/health`, token)) as AdminHealth;
}

/** GET /summary (con rango) */
export async function adminSummary(
  token: string,
  range?: RangePreset | RangeParams | DateRange | null
) {
  const params = withRange({}, normalizePanelRange(range));
  const qs = buildQs(params);
  return (await apiAdmin(`/summary${qs}`, token)) as AdminSummary;
}

/** GET /events (con filtros + rango) */
export async function adminEvents(
  token: string,
  args?: {
    name?: string;
    userId?: string;
    q?: string;
    limit?: number;
    cursor?: string;
    range?: RangePreset | RangeParams | DateRange | null;
  }
) {
  const base = {
    name: args?.name,
    userId: args?.userId,
    q: args?.q,
    limit: args?.limit,
    cursor: args?.cursor,
  };

  const params = withRange(base, normalizePanelRange(args?.range || null));
  const qs = buildQs(params);
  return (await apiAdmin(`/events${qs}`, token)) as AdminEventsResponse;
}

/** GET /users (tabla CRM; rango filtra createdAt por from/to) */
export async function adminUsers(
  token: string,
  args?: {
    q?: string;
    limit?: number;
    cursor?: string;
    range?: RangePreset | RangeParams | DateRange | null;
  }
) {
  const r: RangeParams =
    typeof args?.range === "string"
      ? makeRangePreset(args.range)
      : (args?.range as any) || {};

  const params: Record<string, any> = {
    q: args?.q,
    limit: args?.limit,
    cursor: args?.cursor,
  };

  if (r.from) params.from = r.from;
  if (r.to) params.to = r.to;

  const qs = buildQs(params);
  return (await apiAdmin(`/users${qs}`, token)) as AdminUsersResponse;
}

/** GET /series (con rango y groupBy) */
export async function adminSeries(
  token: string,
  args: {
    name: string;
    groupBy: "hour" | "day" | "week" | "month";
    range?: RangePreset | RangeParams | DateRange | null;
  }
) {
  const params = withRange(
    {
      name: args.name,
      groupBy: args.groupBy,
    },
    normalizePanelRange(args.range || null)
  );

  const qs = buildQs(params);
  return (await apiAdmin(`/series${qs}`, token)) as AdminSeriesResponse;
}

/** GET /funnel (con rango y steps) */
export async function adminFunnel(
  token: string,
  args?: {
    steps?: string[];
    range?: RangePreset | RangeParams | DateRange | null;
  }
) {
  const params = withRange(
    {
      steps: args?.steps?.length ? args.steps.join(",") : undefined,
    },
    normalizePanelRange(args?.range || null)
  );

  const qs = buildQs(params);
  return (await apiAdmin(`/funnel${qs}`, token)) as AdminFunnelResponse;
}

/** Conveniencia: leer token actual desde sessionStorage */
export function getInternalAdminToken() {
  try {
    return sessionStorage.getItem(SS_KEY);
  } catch {
    return null;
  }
}

/** Conveniencia: set token */
export function setInternalAdminToken(token: string) {
  try {
    sessionStorage.setItem(SS_KEY, token);
  } catch {
    // noop
  }
}

/** Conveniencia: remove token */
export function clearInternalAdminToken() {
  try {
    sessionStorage.removeItem(SS_KEY);
  } catch {
    // noop
  }
}
