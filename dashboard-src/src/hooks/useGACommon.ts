// dashboard-src/src/hooks/useGACommon.ts

type GAPropertiesResp =
  | {
      ok: true;
      properties: Array<{ propertyId: string; displayName?: string }>;
      defaultPropertyId: string | null;
      selectedPropertyIds?: string[];
      availableCount?: number;
    }
  | {
      ok: false;
      requiredSelection?: boolean;
      reason?: string;
      properties?: Array<{ propertyId: string; displayName?: string }>;
      defaultPropertyId?: string | null;
      error?: string;
    };

function normalizeProperty(val: string | null | undefined): string | null {
  const raw = String(val || "").trim();
  if (!raw) return null;

  // ya viene bien
  if (/^properties\/\d+$/.test(raw)) return raw;

  // viene como número o con basura
  const digits = raw.replace(/^properties\//, "").replace(/[^\d]/g, "");
  if (!digits) return null;
  return `properties/${digits}`;
}

function getSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function setQueryParam(key: string, value: string) {
  const sp = getSearchParams();
  sp.set(key, value);
  const next = `${window.location.pathname}?${sp.toString()}`;
  window.history.replaceState({}, document.title, next);
}

function safeSetLS(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
function safeGetLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Lee property desde ?property=... o localStorage
export function getGAProperty(): string | null {
  const sp = getSearchParams();
  const fromQS = normalizeProperty(sp.get("property"));
  if (fromQS) {
    safeSetLS("ga_property", fromQS);
    return fromQS;
  }

  const fromLS = normalizeProperty(safeGetLS("ga_property"));
  return fromLS;
}

const RANGE_MAP: Record<string, string> = {
  "30": "last_30_days",
  // OJO: si tu backend NO soporta last_60_days, esto cae en fallback.
  // Si quieres 60 real, agrégalo en backend buildDateRange().
  "60": "last_60_days",
  "90": "last_90_days",
};

export function getGARange(): string {
  const sp = getSearchParams();
  const raw = sp.get("range") || "30";
  return RANGE_MAP[raw] || "last_30_days";
}

/* =========================
 * Cache corto de /properties para no pegarle 10 veces
 * ========================= */
let _propsCache: { at: number; data: GAPropertiesResp } | null = null;

async function fetchGAProperties(): Promise<GAPropertiesResp> {
  const now = Date.now();
  if (_propsCache && now - _propsCache.at < 30_000) return _propsCache.data;

  const res = await fetch("/api/google/analytics/properties", {
    method: "GET",
    credentials: "include",
  });

  const data = (await res.json().catch(() => ({}))) as GAPropertiesResp;

  // guardamos aunque venga ok:false (para no spamear)
  _propsCache = { at: now, data };

  return data;
}

/**
 * Asegura que el property usado en requests:
 * - exista en /properties
 * - si no existe, use defaultPropertyId o el primero
 * - actualiza localStorage + querystring para que NO vuelva el 403
 */
async function ensureValidGAProperty(current: string | null): Promise<string | null> {
  const propsResp = await fetchGAProperties();

  // Si el backend pide selección (>3) o cualquier ok:false, no podemos inventar
  if (!propsResp || (propsResp as any).ok === false) {
    // devolvemos current para que el error lo maneje el caller (gaFetch lanzará)
    return current;
  }

  const { properties, defaultPropertyId } = propsResp as Extract<GAPropertiesResp, { ok: true }>;
  const available = new Set((properties || []).map((p) => normalizeProperty(p.propertyId)!).filter(Boolean));

  const normalized = normalizeProperty(current);
  if (normalized && available.has(normalized)) {
    // ya es válido, asegúrate de persistirlo limpio
    safeSetLS("ga_property", normalized);
    const sp = getSearchParams();
    if (normalizeProperty(sp.get("property")) !== normalized) {
      setQueryParam("property", normalized);
    }
    return normalized;
  }

  // escoger fallback
  const fallback =
    normalizeProperty(defaultPropertyId) ||
    normalizeProperty(properties?.[0]?.propertyId) ||
    null;

  if (fallback) {
    safeSetLS("ga_property", fallback);

    // corrige URL (si no, la app seguirá generando links viejos)
    setQueryParam("property", fallback);
  }

  return fallback;
}

function isGAEndpoint(u: URL): boolean {
  return u.pathname.startsWith("/api/google/analytics/");
}

function isGAPropertiesEndpoint(u: URL): boolean {
  return u.pathname === "/api/google/analytics/properties";
}

export async function gaFetch<T = any>(url: string): Promise<T> {
  const u = new URL(url, window.location.origin);

  // Interceptor definitivo: si es endpoint GA (menos /properties),
  // valida property y lo corrige para evitar 403.
  if (isGAEndpoint(u) && !isGAPropertiesEndpoint(u)) {
    const sp = u.searchParams;
    const current = normalizeProperty(sp.get("property") || sp.get("propertyId") || getGAProperty() || "");
    const effective = await ensureValidGAProperty(current);

    if (effective) {
      sp.set("property", effective);
      sp.delete("propertyId");
    }
    u.search = sp.toString();
  }

  const res = await fetch(u.toString(), {
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    const msg =
      data?.reason ||
      data?.error ||
      `GA request failed: ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  return data as T;
}
