import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

type MerchantAccount = {
  merchantId: string;
  displayName?: string | null;
  websiteUrl?: string | null;
  accountStatus?: string | null;
  aggregatorId?: string | null;
};

type MerchantAccountsResponse = {
  ok: boolean;
  merchantAccounts: MerchantAccount[];
  selectedMerchantIds: string[];
  defaultMerchantId: string | null;
};

async function apiJson<T>(url: string) {
  const r = await fetch(url, { credentials: "include" });
  const txt = await r.text();
  if (!r.ok) throw new Error(txt || `HTTP ${r.status}`);
  return JSON.parse(txt) as T;
}

async function apiPost<T>(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(txt || `HTTP ${r.status}`);
  return (txt ? JSON.parse(txt) : {}) as T;
}

function normMerchantId(value: string | null | undefined) {
  return String(value || "").trim().replace(/^accounts\//, "").replace(/[^\d]/g, "");
}

export function GoogleMerchantSelectorDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<MerchantAccount[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);

    apiJson<MerchantAccountsResponse>("/auth/google/merchant/accounts?refresh=1")
      .then((data) => {
        if (!active) return;
        const merchantAccounts = Array.isArray(data?.merchantAccounts) ? data.merchantAccounts : [];
        const selectedIds = (data?.selectedMerchantIds || []).map(normMerchantId).filter(Boolean);
        const defaultId = normMerchantId(data?.defaultMerchantId);
        setAccounts(merchantAccounts);
        setSelected(selectedIds.length ? [selectedIds[0]] : defaultId ? [defaultId] : []);
      })
      .catch((e) => { if (active) setError(e?.message || "No se pudieron cargar las cuentas."); })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [open]);

  const selectedId = useMemo(() => (selected[0] ? normMerchantId(selected[0]) : ""), [selected]);

  const save = async () => {
    if (!selectedId) { setError("Selecciona una cuenta para continuar."); return; }
    setSaving(true);
    setError(null);
    try {
      await apiPost("/auth/google/merchant/selection", { merchantIds: [selectedId] });
      onOpenChange(false);
      await onSaved?.();
    } catch (e: unknown) {
      setError((e as Error)?.message || "No se pudo guardar la selección.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-2xl rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,10,15,0.98),rgba(14,14,20,0.98))] text-white shadow-[0_30px_100px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
        <DialogHeader>
          <DialogTitle>Selecciona tu cuenta de Google Merchant Center</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm leading-6 text-white/60">
            Elige la cuenta de Merchant Center que Adray usará para catálogo y feeds de producto.
          </p>

          {loading && (
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-white/70">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando cuentas de Merchant Center...
            </div>
          )}

          {!loading && accounts.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-white/70">
              No se encontraron cuentas accesibles de Merchant Center.
            </div>
          )}

          {!loading && accounts.length > 0 && (
            <div className="space-y-3">
              {accounts.map((account) => {
                const mid = normMerchantId(account.merchantId);
                return (
                  <button
                    key={mid}
                    type="button"
                    onClick={() => setSelected(mid ? [mid] : [])}
                    className="w-full rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.72)_0%,rgba(12,12,16,0.88)_100%)] p-4 text-left transition hover:border-white/15"
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={mid === selectedId}
                        className="mt-1 border-white/30 data-[state=checked]:border-[#B55CFF] data-[state=checked]:bg-[#B55CFF]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">
                            {account.displayName || `Merchant ${mid}`}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/60">
                            ID {mid}
                          </span>
                        </div>
                        {account.websiteUrl && (
                          <div className="mt-1 truncate text-sm text-white/50">{account.websiteUrl}</div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-400/15 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="rounded-xl border border-white/10 bg-white/[0.05] text-white hover:bg-white/[0.08]"
          >
            Cancelar
          </Button>
          <Button
            onClick={save}
            disabled={saving || loading || !selectedId}
            className="rounded-xl border border-fuchsia-400/15 bg-[linear-gradient(135deg,rgba(168,85,247,0.24),rgba(34,211,238,0.14))] text-white hover:opacity-95"
          >
            {saving ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Guardando...
              </span>
            ) : "Guardar selección"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
