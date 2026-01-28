// dashboard-src/src/hooks/useGoogleAdsAccounts.ts
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { normalizeCustomerId } from "./useGoogleAdsInsights";

export type AdsAccount = {
  id: string;              // siempre dígitos (sin guiones)
  name: string;
  currencyCode?: string | null;
  timeZone?: string | null;
  status?: string | null;
};

export type AccountsState = {
  loading: boolean;
  error: string | null;
  accounts: AdsAccount[];
  defaultCustomerId: string | null;   // dígitos
  requiredSelection: boolean;
};

type ApiResp = {
  ok?: boolean;
  error?: string;
  accounts?: any[];
  ad_accounts?: any[];
  defaultCustomerId?: string | null;
  requiredSelection?: boolean;
};

const dedupe = <T,>(arr: T[], key: (x: T) => string) => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
};

// Normaliza un objeto de cuenta del backend a AdsAccount
function mapAccount(a: any): AdsAccount {
  const id = normalizeCustomerId(a?.id);
  const name =
    a?.name ||
    a?.descriptiveName ||
    a?.descriptive_name ||
    (id ? `Cuenta ${id}` : "");

  // el backend puede devolver distintas llaves según provenga de GAQL o del doc
  const currency =
    a?.currencyCode ?? a?.currency_code ?? a?.currency ?? null;
  const tz =
    a?.timeZone ?? a?.time_zone ?? a?.timezone ?? null;
  const status =
    a?.status ?? a?.accountStatus ?? null;

  return {
    id,
    name,
    currencyCode: currency || null,
    timeZone: tz || null,
    status: status || null,
  };
}

export default function useGoogleAdsAccounts() {
  const [state, setState] = useState<AccountsState>({
    loading: true,
    error: null,
    accounts: [],
    defaultCustomerId: null,
    requiredSelection: false,
  });

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (force = false) => {
    // cancelación preventiva
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const qs = force ? "?force=1" : "";
      const r = await fetch(`/api/google/ads/insights/accounts${qs}`, {
        credentials: "include",
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });

      let data: ApiResp = {};
      try {
        data = (await r.json()) as ApiResp;
      } catch {
        // respuesta no JSON: tratamos como error genérico
      }

      // Si el servidor nos pide selección, no lo tratamos como "error",
      // solo prendemos el flag para que el UI muestre el modal/lista.
      if (r.status === 400 && data?.error === "SELECTION_REQUIRED") {
        setState((s) => ({
          ...s,
          loading: false,
          error: null,
          requiredSelection: true,
        }));
        return;
      }

      // Errores de autenticación
      if (r.status === 401) {
        setState((s) => ({
          ...s,
          loading: false,
          error: "UNAUTHORIZED",
        }));
        return;
      }

      // Otros errores
      if (!r.ok || data?.ok === false) {
        setState((s) => ({
          ...s,
          loading: false,
          error: data?.error || "ACCOUNTS_ERROR",
        }));
        return;
      }

      // ---- ÉXITO ----
      const listRaw =
        (Array.isArray(data?.accounts) && data.accounts) ||
        (Array.isArray(data?.ad_accounts) && data.ad_accounts) ||
        [];

      const mapped = listRaw.map(mapAccount);

      // elimina vacíos/duplicados y ordena
      const accounts = dedupe(
        mapped.filter((a) => !!a.id),
        (x) => x.id
      ).sort(
        (a, b) =>
          (a.name || "").localeCompare(b.name || "") ||
          a.id.localeCompare(b.id)
      );

      // Respetamos el default que llega del backend si existe.
      // Solo si viene vacío y tenemos cuentas, usamos la primera.
      const defaultCustomerIdFromApi = normalizeCustomerId(
        data?.defaultCustomerId || null
      );
      const defaultCustomerId =
        defaultCustomerIdFromApi ||
        (accounts[0]?.id ? normalizeCustomerId(accounts[0].id) : null);

      setState((s) => ({
        ...s,
        loading: false,
        error: null,
        accounts,
        defaultCustomerId,
        requiredSelection: !!data?.requiredSelection,
      }));
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      // mantenemos la lista previa para evitar parpadeos en UI
      setState((s) => ({
        ...s,
        loading: false,
        error: e?.message || "ACCOUNTS_ERROR",
      }));
    }
  }, []);

  useEffect(() => {
    void load(false);
    return () => abortRef.current?.abort();
  }, [load]);

  const mapById = useMemo(() => {
    const m = new Map<string, AdsAccount>();
    for (const a of state.accounts) m.set(a.id, a);
    return m;
  }, [state.accounts]);

  const getDisplayName = useCallback(
    (id?: string | null) => {
      const k = normalizeCustomerId(id || "");
      return mapById.get(k)?.name || (k ? `Cuenta ${k}` : "");
    },
    [mapById]
  );

  return {
    ...state,
    mapById,
    getDisplayName,
    /**
     * Refresca la lista. Usa `refresh(true)` para forzar enriquecimiento de nombres (GAQL vía MCC).
     */
    refresh: load,
  };
}
