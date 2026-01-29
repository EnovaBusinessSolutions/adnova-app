import { useCallback, useEffect, useState } from "react";

export type AdAccount = {
  id: string;
  name?: string | null;
  currency?: string | null;
  status?: number | null;
  timezone_name?: string | null;
};

type Res = {
  ok: boolean;
  accounts: AdAccount[];
  defaultAccountId: string | null;
};

export default function useMetaAccounts() {
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const r = await fetch("/api/meta/insights/accounts");
      const j: Res = await r.json();
      if (!r.ok || !j.ok) {
        throw new Error((j as any)?.error || "ACCOUNTS_ERROR");
      }
      setAccounts(j.accounts || []);
      setDefaultAccountId(j.defaultAccountId || "");
    } catch (e: any) {
      setError(e?.message || "Error cargando cuentas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { accounts, defaultAccountId, loading, error, refresh };
}
