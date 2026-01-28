// dashboard-src/src/components/google-ads/GoogleAdsHeader.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router-dom";
import useGoogleAdsAccounts from "../../hooks/useGoogleAdsAccounts";

import { Calendar, RefreshCw, SlidersHorizontal, ChevronsUpDown, Check, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";

import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

type Preset =
  | "today"
  | "yesterday"
  | "this_month"
  | "last_7d"
  | "last_14d"
  | "last_28d"
  | "last_60d"
  | "last_90d"
  | "last_30d";

type RangeOption = { label: string; preset: Preset } | { label: string; range: "30" };

const DATE_RANGES: RangeOption[] = [
  { label: "Últimos 30 días", preset: "last_30d" },
  { label: "Hoy (24 h)", preset: "today" },
  { label: "Ayer (24 h)", preset: "yesterday" },
  { label: "Este mes", preset: "this_month" },
  { label: "Últimos 7 días", preset: "last_7d" },
  { label: "Últimos 14 días", preset: "last_14d" },
  { label: "Últimos 28 días", preset: "last_28d" },
  { label: "Últimos 60 días", preset: "last_60d" },
  { label: "Últimos 90 días", preset: "last_90d" },
  { label: "Últimos 30 días (compat)", range: "30" },
];

type Objective = "ventas" | "alcance" | "leads";
const OBJECTIVE_LABEL: Record<Objective, string> = {
  ventas: "Ventas",
  alcance: "Alcance",
  leads: "Leads",
};

type CampaignFilter = "all" | "active" | "paused" | "deleted";
const CAMPAIGN_FILTERS: { label: string; value: CampaignFilter }[] = [
  { label: "Todas las campañas", value: "all" },
  { label: "Campañas activas", value: "active" },
  { label: "Campañas pausadas", value: "paused" },
  { label: "Campañas eliminadas", value: "deleted" },
];

type Props = {
  onRefresh?: () => void;
  onOpenSelectionModal?: () => void;
};

type GoogleAdAccount = {
  id: string | number;
  name?: string;
  currencyCode?: string;
  timeZone?: string;
  status?: string;
};

function setParam(params: URLSearchParams, key: string, value?: string | null): URLSearchParams {
  const p = new URLSearchParams(params);
  if (value === undefined || value === null || value === "") p.delete(key);
  else p.set(key, value);
  return p;
}

function patchParams(params: URLSearchParams, patch: Record<string, string | undefined | null>): URLSearchParams {
  const p = new URLSearchParams(params);
  Object.entries(patch).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") p.delete(k);
    else p.set(k, v);
  });
  return p;
}

const normId = (id?: string | number | null) => String(id ?? "").replace(/^customers\//, "").replace(/[^\d]/g, "");

async function persistDefaultCustomer(customerId: string) {
  try {
    await fetch("/api/google/ads/insights/default", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ customerId }),
    });
  } catch {}
}

function AccountsCombobox({
  accounts,
  value,
  onChange,
  disabled,
  loading,
}: {
  accounts: GoogleAdAccount[];
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const current = accounts.find((a) => normId(a.id) === value);
  const label = current?.name || current?.id?.toString() || (loading ? "Cargando cuentas..." : "Selecciona una cuenta");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full md:w-[320px] justify-between">
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[280px] p-0" align="start" sideOffset={8}>
        <Command>
          <CommandInput placeholder="Buscar cuenta…" />
          <CommandEmpty>No se encontraron resultados.</CommandEmpty>
          <CommandList>
            <CommandGroup heading="Cuentas">
              {accounts
                .slice()
                .sort((a, b) => (a.name || String(a.id)).localeCompare(b.name || String(b.id)))
                .map((a) => {
                  const idNorm = normId(a.id);
                  const selected = idNorm === value;
                  return (
                    <CommandItem
                      key={String(a.id)}
                      value={`${a.name ?? ""} ${a.id}`}
                      onSelect={() => {
                        onChange(idNorm);
                        setOpen(false);
                      }}
                    >
                      <Check className={`mr-2 h-4 w-4 ${selected ? "opacity-100" : "opacity-0"}`} />
                      <div className="flex flex-col">
                        <span className="text-sm">{a.name || String(a.id)}</span>
                        <span className="text-xs text-muted-foreground">{idNorm}</span>
                      </div>
                    </CommandItem>
                  );
                })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const GoogleAdsHeader: React.FC<Props> = ({ onRefresh, onOpenSelectionModal }) => {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const { accounts, defaultCustomerId, requiredSelection, loading, error } = useGoogleAdsAccounts();

  const urlAccountId = params.get("account_id") || undefined;

  const firstId = useMemo(() => normId(accounts?.[0]?.id), [accounts]);
  const fallbackId = useMemo(() => normId(defaultCustomerId) || firstId || undefined, [defaultCustomerId, firstId]);

  useEffect(() => {
    const hasPreset = !!params.get("date_preset");
    const hasRange = !!params.get("range");
    if (!hasPreset && !hasRange) {
      setParams(patchParams(params, { date_preset: "last_30d", include_today: "0" }), { replace: true });
    }
  }, []);

  useEffect(() => {
    if (!loading && !urlAccountId && fallbackId) {
      setParams(setParam(params, "account_id", fallbackId), { replace: true });
    }
  }, [loading, urlAccountId, fallbackId, params, setParams]);

  useEffect(() => {
    if (loading || !urlAccountId) return;
    const exists = (accounts || []).some((a) => normId(a.id) === normId(urlAccountId));
    if (!exists && fallbackId) setParams(setParam(params, "account_id", fallbackId), { replace: true });
  }, [loading, urlAccountId, accounts, fallbackId, params, setParams]);

  const accountId = (urlAccountId ? normId(urlAccountId) : fallbackId) || undefined;

  const datePresetParam = (params.get("date_preset") || "").toLowerCase();
  const rangeParam = params.get("range") || "30";
  const includeToday = params.get("include_today") === "1";
  const objective = (params.get("objective") || "ventas") as Objective;
  const campaignFilter = (params.get("campaign_filter") || "all") as CampaignFilter;

  const currentRangeLabel = useMemo(() => {
    if (datePresetParam) {
      const opt = DATE_RANGES.find((r) => "preset" in r && r.preset === (datePresetParam as Preset));
      if (opt) return opt.label;
    }
    if (rangeParam === "30") return "Últimos 30 días";
    return "Últimos 30 días";
  }, [datePresetParam, rangeParam]);

  const handleRangePreset = (opt: RangeOption) => {
    if ("preset" in opt) {
      const patch: Record<string, string | null> = { date_preset: opt.preset, range: null };
      if (opt.preset === "today") patch.include_today = "1";
      else if (opt.preset === "yesterday") patch.include_today = "0";
      else patch.include_today = includeToday ? "1" : "0";
      setParams(patchParams(params, patch));
      return;
    }
    setParams(patchParams(params, { range: opt.range, date_preset: null, include_today: includeToday ? "1" : "0" }));
  };

  const handleIncludeToday = (checked: boolean) => setParams(setParam(params, "include_today", checked ? "1" : "0"));

  const handleAccountChange = async (id: string) => {
    const cid = normId(id);
    if (!(accounts || []).some((a) => normId(a.id) === cid)) return;
    await persistDefaultCustomer(cid);
    setParams(setParam(params, "account_id", cid));
  };

  const handleObjective = (obj: Objective) => setParams(setParam(params, "objective", obj));
  const handleCampaignFilter = (value: CampaignFilter) => setParams(setParam(params, "campaign_filter", value));

  const doRefresh = () => {
    if (onRefresh) return onRefresh();
    const next = setParam(params, "r", String(Date.now()));
    navigate(`${pathname}?${next.toString()}`, { replace: true });
  };

  return (
    <div
  className={[
    "sticky top-0 z-20 md:z-[80]", // ✅ FIX: móvil debajo del menú, desktop igual
    "border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
    "pt-[env(safe-area-inset-top)]", // ✅ iOS: respeta notch (opcional pero recomendado)
  ].join(" ")}
>
      <div className="px-4 md:px-6">
        {requiredSelection && (
          <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-50 px-3 py-3 text-amber-900 dark:border-amber-400/25 dark:bg-amber-900/20 dark:text-amber-100">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="text-sm leading-snug">Para continuar, selecciona las cuentas de Google Ads que quieres visualizar.</div>
            </div>
            <div className="mt-3">
              <Button variant="outline" size="sm" className="w-full md:w-auto" onClick={() => onOpenSelectionModal?.()}>
                Seleccionar cuentas
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">G</span>
            <div>
              <h2 className="text-lg md:text-xl font-semibold leading-tight">Google Ads</h2>
              <p className="text-xs md:text-sm text-muted-foreground">Análisis de campañas</p>
            </div>
          </div>

          <div className="overflow-x-auto md:overflow-visible">
            <div className="inline-flex min-w-max rounded-2xl border bg-muted/30 p-1">
              {(["ventas", "alcance", "leads"] as Objective[]).map((key) => {
                const active = objective === key;
                return (
                  <Button key={key} size="sm" variant={active ? "default" : "ghost"} className={`rounded-xl px-3 ${active ? "shadow-sm" : ""}`} onClick={() => handleObjective(key)}>
                    {OBJECTIVE_LABEL[key]}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 pb-4 md:flex-row md:items-center md:justify-between">
          <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center md:gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 col-span-2 md:col-auto">
                  <Calendar className="h-4 w-4" />
                  <span className="truncate">{currentRangeLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Rangos rápidos</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {DATE_RANGES.map((r) => {
                  const isActive = ("preset" in r && r.preset === (datePresetParam as Preset)) || ("range" in r && r.range === rangeParam);
                  return (
                    <DropdownMenuItem key={r.label} onClick={() => handleRangePreset(r)} className={isActive ? "bg-muted" : ""}>
                      {r.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 col-span-1 md:col-auto">
              <label htmlFor="include-today" className="text-sm">
                Incluir hoy
              </label>
              <Switch id="include-today" checked={includeToday} onCheckedChange={handleIncludeToday} />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 col-span-1 md:col-auto">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filtro
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {CAMPAIGN_FILTERS.map((f) => (
                  <DropdownMenuItem key={f.value} onClick={() => handleCampaignFilter(f.value)} className={campaignFilter === f.value ? "font-medium" : ""}>
                    {f.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
            <div className="w-full md:w-auto">
              <AccountsCombobox accounts={accounts || []} value={accountId} onChange={handleAccountChange} disabled={loading || requiredSelection} loading={loading} />
            </div>

            <Button onClick={doRefresh} size="sm" className="w-full md:w-auto gap-2" disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
        </div>

        <div className="pb-3 text-xs text-muted-foreground">
          Rango: {currentRangeLabel}
          {includeToday ? " (incluye hoy)" : ""} · Cuenta: {accountId || "—"}
          {error ? ` · Error: ${String(error)}` : ""}
        </div>
      </div>
    </div>
  );
};

export default GoogleAdsHeader;
