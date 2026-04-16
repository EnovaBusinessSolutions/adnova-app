# FASE 4 — Google Merchant Center: Frontend

## Instrucciones de eficiencia
Lee ÚNICAMENTE los archivos indicados. No explores otros. Sé quirúrgico y preciso.

---

## Contexto
Backend completo (Fases 1-3). Ahora hay que integrar Merchant Center en el frontend.

Los archivos a tocar son exactamente tres. Lee cada uno antes de modificarlo.

---

## ARCHIVO 1 (nuevo): `dashboard-src/src/components/google/GoogleMerchantSelectorDialog.tsx`

Crea este archivo nuevo. Es un dialog modal para seleccionar cuenta de Merchant Center.

```tsx
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
```

---

## ARCHIVO 2 (modificar): `dashboard-src/src/pages/Settings.tsx`

Lee el archivo completo antes de modificar. Aplica estos cambios quirúrgicos:

### 2a. Extender tipo `OnboardingStatus`
Agrega el bloque `merchant` junto a `ga4` y `shopify`:
```ts
merchant: {
  connected: boolean;
  availableCount: number;
  selectedCount: number;
  requiredSelection: boolean;
  selected: string[];
  defaultMerchantId: string | null;
  maxSelect: number;
};
integrationReady?: {
  merchant?: boolean;
};
```

### 2b. Extender `DisconnectKind`
```ts
type DisconnectKind = "meta" | "google_ads" | "ga4" | "shopify" | "merchant";
```

### 2c. Import del dialog
Agrega junto a los demás imports:
```ts
import { GoogleMerchantSelectorDialog } from "@/components/google/GoogleMerchantSelectorDialog";
```

### 2d. Agregar `merchant` a `connections`
En el objeto `connections` donde se calcula `shopify`, `meta`, etc.:
```ts
merchant: !!st?.merchant?.connected,
```

### 2e. Agregar `merchant` al conteo `connectedCount`
En el array que suma las conexiones:
```ts
connections.merchant
```

### 2f. Agregar caso `merchant` en `disconnectLabel`
```ts
if (disconnectKind === "merchant") return "Google Merchant Center";
```

### 2g. Estado y lógica del selector Merchant
Agrega junto a los estados existentes:
```ts
const [merchantSelectorOpen, setMerchantSelectorOpen] = useState(false);

const merchantNeedsSelection = !!(
  connections.merchant &&
  (st?.merchant?.requiredSelection ||
    ((st?.merchant?.availableCount || 0) > 1 && (st?.merchant?.selectedCount || 0) === 0))
);

const merchantReady = !!(
  st?.integrationReady?.merchant ||
  (connections.merchant &&
    ((st?.merchant?.selectedCount || 0) > 0 || !!st?.merchant?.defaultMerchantId) &&
    !merchantNeedsSelection)
);

const merchantActionLabel = merchantReady ? "Connected" : merchantNeedsSelection ? "Select" : "Connect";
const merchantConnectUrl = `/auth/google/merchant/connect?returnTo=${encodeURIComponent("/dashboard/settings?tab=integrations&selector=1&google=ok&product=merchant")}`;
```

### 2h. Abrir selector Merchant automáticamente desde URL
En el `useEffect` que maneja los query params de la URL (donde ya se maneja `tab`, `google`, etc.), agrega:
```ts
const selector = qs.get("selector") === "1";
const product = (qs.get("product") || "").toLowerCase();
if (selector && product === "merchant" && qs.get("google") === "ok") {
  setMerchantSelectorOpen(true);
}
```

### 2i. Callback `handleMerchantSaved`
```ts
const handleMerchantSaved = async () => {
  await loadStatus();
};
```
Donde `loadStatus` es la función que recarga el estado del onboarding (la que llama a `/api/onboarding/status`).

### 2j. Tarjeta Merchant en la lista de integraciones
Agrega junto a la tarjeta de GA4, siguiendo exactamente el mismo patrón de `IntegrationRow`:
```tsx
<IntegrationRow
  icon={ShoppingBag}
  name="Google Merchant Center"
  subLabel={
    merchantReady
      ? "Merchant Center account connected and ready for product intelligence."
      : "Connect Merchant Center to unlock catalog and product feed insights."
  }
  connected={connections.merchant}
  onDisconnect={connections.merchant ? () => openDisconnect("merchant") : undefined}
/>
```
Y fuera del `IntegrationRow`, agrega un botón de acción si no está listo:
```tsx
{!merchantReady && (
  <div className="mt-2 flex justify-end">
    <Button
      size="sm"
      onClick={() => {
        if (merchantNeedsSelection) { setMerchantSelectorOpen(true); return; }
        if (!connections.merchant) { window.location.assign(merchantConnectUrl); }
      }}
      className="rounded-xl border border-white/10 bg-white/[0.05] px-4 text-white hover:bg-white/[0.08]"
    >
      {merchantActionLabel} →
    </Button>
  </div>
)}
```

### 2k. Render del dialog Merchant
Agrega junto al Dialog de disconnect:
```tsx
<GoogleMerchantSelectorDialog
  open={merchantSelectorOpen}
  onOpenChange={setMerchantSelectorOpen}
  onSaved={handleMerchantSaved}
/>
```

### 2l. Import del icono `ShoppingBag`
Agrégalo al import de `lucide-react` si no existe.

---

## ARCHIVO 3 (modificar): `dashboard-src/src/pages/Index.tsx`

Lee el archivo completo. Aplica solo estos cambios:

### 3a. Extender tipo `OnboardingStatus` (si está definido localmente)
Agrega `merchant` igual que en Settings.tsx.

### 3b. Variables de estado Merchant
Junto a `googleAdsConnected` y `ga4Connected`:
```ts
const merchantConnected = !!st?.merchant?.connected;
const merchantReady = !!(
  st?.integrationReady?.merchant ||
  (merchantConnected &&
    (st?.merchant?.selectedCount || 0) > 0 &&
    !(st?.merchant?.requiredSelection))
);
const merchantNeedsPick = merchantConnected && !!(
  st?.merchant?.requiredSelection ||
  ((st?.merchant?.availableCount || 0) > 1 && (st?.merchant?.selectedCount || 0) === 0)
);
const connectGoogleMerchantUrl = `/auth/google/merchant/connect?returnTo=${encodeURIComponent(
  `${window.location.origin}/?selector=1&google=ok&product=merchant`
)}`;
```

### 3c. Agregar merchant a `requiredSelectionSafe`
En el useMemo de `requiredSelectionSafe`, agrega:
```ts
const merchant = !!st?.merchant?.requiredSelection ||
  ((st?.merchant?.availableCount || 0) > 1 && (st?.merchant?.selectedCount || 0) === 0);
return { meta, googleAds, ga4, merchant };
```

### 3d. Agregar merchant a `hasRequiredSelection`
```ts
return requiredSelectionSafe.meta || requiredSelectionSafe.googleAds || requiredSelectionSafe.ga4 || requiredSelectionSafe.merchant;
```

### 3e. Manejar `product=merchant` en el hook de URL
Donde ya se maneja `product=ga4` y `product=ads`, agrega:
```ts
if (selector && product === "merchant") {
  // abrir selector merchant si merchantNeedsPick
  if (merchantNeedsPick) openSelectorFor("merchant", { merchant: true }, true);
}
```
Si `openSelectorFor` no soporta `"merchant"` como key, agrégalo al tipo y al switch/if correspondiente.

### 3f. Agregar step Merchant al array `steps`
Al final del array `steps` (después del step `google_analytics`), agrega:
```ts
{
  key: "merchant",
  title: "Merchant Center",
  desc: merchantReady
    ? "Merchant Center account connected and ready for product intelligence."
    : merchantNeedsPick
      ? "Select your Merchant Center account to complete the setup."
      : "Connect Merchant Center to unlock catalog and product feed insights.",
  icon: <ShoppingBag className="h-4 w-4 text-[#B55CFF]" />,
  state: merchantReady ? ("done" as StepState) : ("todo" as StepState),
  todoLabel: merchantReady ? "Completed" : "Pending",
  ctaLabel: merchantReady ? "Connected" : merchantNeedsPick ? "Select" : "Connect",
  ctaDisabled: merchantReady,
  onCta: () => {
    if (merchantReady) return;
    if (merchantNeedsPick) return openSelectorFor("merchant", { merchant: true }, true);
    window.location.assign(connectGoogleMerchantUrl);
  },
},
```

### 3g. Agregar `merchantConnected`, `merchantReady`, `merchantNeedsPick`, `connectGoogleMerchantUrl` al array de dependencias del useMemo de `steps`.

### 3h. Agregar `GoogleMerchantSelectorDialog` al render
Si `Index.tsx` ya renderiza otros selectores (GoogleAds, GA4), agrega el de Merchant siguiendo el mismo patrón. Si usa un sistema de `openSelectorFor` genérico, extiéndelo para soportar `"merchant"`.

### 3i. Import `ShoppingBag` de lucide-react si no existe.

---

## Reglas estrictas
- **NO modifiques** la lógica de Meta, Google Ads ni GA4 existente.
- **NO cambies** el estilo visual de cards/rows existentes.
- **NO toques** ningún otro archivo fuera de los 3 indicados.
- Sigue el mismo estilo, naming e indentación de cada archivo.
- Si alguna variable o tipo ya existe, verifica que coincida con esta spec.

---

## Verificación esperada
1. `GoogleMerchantSelectorDialog.tsx` existe y compila sin errores.
2. `Settings.tsx`: tipo `OnboardingStatus` incluye `merchant` e `integrationReady`. `DisconnectKind` incluye `"merchant"`. Tarjeta Merchant visible con Connect/Select/Connected. Dialog Merchant renderizado.
3. `Index.tsx`: step `merchant` presente en el array `steps`. `merchantConnected` y `merchantReady` calculados. URL `product=merchant&selector=1` abre selector.
4. `npm run build` (o `tsc --noEmit`) sin errores de TypeScript en estos archivos.
5. Ninguna lógica de Meta, Ads ni GA4 fue modificada.
