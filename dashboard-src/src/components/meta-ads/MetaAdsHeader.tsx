// dashboard-src/src/components/meta-ads/MetaAdsHeader.tsx
import React, { useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import useMetaAccounts from "@/hooks/useMetaAccounts";

import { Calendar, RefreshCw, SlidersHorizontal, ChevronsUpDown, Check } from "lucide-react";

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

/* =========================
   Helpers / Types
========================= */
type RangeOption = { label: string; preset: string };

const DATE_RANGES: RangeOption[] = [
  { label: "Últimos 30 días", preset: "last_30d" },
  { label: "Hoy (24 h)", preset: "today" },
  { label: "Ayer (24 h)", preset: "yesterday" },
  { label: "Últimos 7 días", preset: "last_7d" },
  { label: "Últimos 14 días", preset: "last_14d" },
  { label: "Últimos 28 días", preset: "last_28d" },
  { label: "Este mes", preset: "this_month" },
];

type Objective = "ventas" | "alcance" | "leads";
const OBJECTIVE_LABEL: Record<Objective, string> = {
  ventas: "Ventas",
  alcance: "Campañas de alcance",
  leads: "Leads / Mensajes",
};
const OBJECTIVE_LABEL_SHORT: Record<Objective, string> = {
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

type Props = { onRefresh?: () => void };

function setParam(params: URLSearchParams, key: string, value?: string | null) {
  const p = new URLSearchParams(params);
  if (value === undefined || value === null || value === "") p.delete(key);
  else p.set(key, value);
  return p;
}
function patchParams(params: URLSearchParams, patch: Record<string, string | undefined | null>) {
  const p = new URLSearchParams(params);
  Object.entries(patch).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") p.delete(k);
    else p.set(k, v);
  });
  return p;
}

const normalizeActId = (id?: string | null) => {
  const s = String(id ?? "").trim();
  return s.replace(/^act_/, "").trim();
};

/* =========================
   Combobox
========================= */
type Account = { id: string; name?: string };

function AccountsCombobox({
  accounts,
  value,
  onChange,
  disabled,
  loading,
}: {
  accounts: Account[];
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  const selected = accounts.find((a) => normalizeActId(a.id) === normalizeActId(value));
  const label =
    selected?.name ||
    (selected?.id ? `act_${normalizeActId(selected.id)}` : "") ||
    (loading ? "Cargando cuentas..." : "Selecciona una Ad Account");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full md:w-[340px] justify-between"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] max-w-[calc(100vw-2rem)] p-0" align="end">
        <Command>
          <CommandInput placeholder="Buscar cuenta…" />
          <CommandEmpty>No se encontraron resultados.</CommandEmpty>

          <CommandList className="max-h-72 overflow-y-auto">
            <CommandGroup heading="Ad Accounts">
              {accounts
                .slice()
                .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
                .map((acc) => {
                  const clean = normalizeActId(acc.id);
                  const isSelected = normalizeActId(value) === clean;

                  return (
                    <CommandItem
                      key={clean}
                      value={`${acc.name || clean} ${clean}`}
                      onSelect={() => {
                        onChange(clean);
                        setOpen(false);
                      }}
                    >
                      <Check className={`mr-2 h-4 w-4 ${isSelected ? "opacity-100" : "opacity-0"}`} />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm truncate">{acc.name || `Cuenta ${clean}`}</span>
                        <span className="text-xs text-muted-foreground truncate">act_{clean}</span>
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

/* =========================
   Component
========================= */
const MetaAdsHeader: React.FC<Props> = ({ onRefresh }) => {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const { accounts, defaultAccountId, loading: accLoading } = useMetaAccounts();

  const normalizedAccounts: Account[] = useMemo(() => {
    return (accounts || [])
      .map((a: any) => ({
        id: normalizeActId(a?.id ?? a?.account_id ?? a?.value ?? ""),
        name: a?.name ?? a?.label ?? undefined,
      }))
      .filter((a) => !!a.id);
  }, [accounts]);

  const urlAccountIdRaw = params.get("account_id");
  const urlAccountId = normalizeActId(urlAccountIdRaw);

  const datePreset = (params.get("date_preset") || "last_30d").toLowerCase();
  const includeToday = params.get("include_today") === "1";
  const objective = ((params.get("objective") || "ventas").toLowerCase() as Objective) || "ventas";
  const campaignFilter = (params.get("campaign_filter") || "all") as CampaignFilter;

  const currentRangeLabel = useMemo(
    () => DATE_RANGES.find((r) => r.preset === datePreset)?.label || "Últimos 30 días",
    [datePreset]
  );

  // Normaliza si viene act_XXXX
  useEffect(() => {
    if (!urlAccountIdRaw) return;
    const clean = normalizeActId(urlAccountIdRaw);
    if (clean && clean !== urlAccountIdRaw) {
      setParams(setParam(params, "account_id", clean), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si no hay account_id en URL, setea fallback cuando cargue
  useEffect(() => {
    if (accLoading) return;
    if (urlAccountId) return;

    const fallback =
      normalizeActId(defaultAccountId) ||
      normalizeActId(normalizedAccounts?.[0]?.id) ||
      "";

    if (!fallback) return;
    setParams(setParam(params, "account_id", fallback), { replace: true });
  }, [accLoading, urlAccountId, defaultAccountId, normalizedAccounts, params, setParams]);

  const handleRangePreset = (preset: string) => {
    const patch: Record<string, string> = { date_preset: preset };
    if (preset === "today") patch.include_today = "1";
    if (preset === "yesterday") patch.include_today = "0";
    setParams(patchParams(params, patch));
  };

  const handleIncludeToday = (checked: boolean) => {
    setParams(setParam(params, "include_today", checked ? "1" : "0"));
  };

  const handleAccountChange = (id: string) => {
    setParams(setParam(params, "account_id", normalizeActId(id)));
  };

  const handleObjective = (obj: Objective) => {
    setParams(setParam(params, "objective", obj));
  };

  const handleCampaignFilter = (value: CampaignFilter) => {
    setParams(setParam(params, "campaign_filter", value));
  };

  const doRefresh = () => {
    if (onRefresh) return onRefresh();
    const next = setParam(params, "r", Date.now().toString());
    navigate(`${pathname}?${next.toString()}`, { replace: true });
  };

  return (
    <div
      data-meta-header="1"
      className={[
        "sticky top-0 z-20 md:z-[80]",
        "border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        "pt-[env(safe-area-inset-top)]",
      ].join(" ")}
    >
      {/* ❗️Sin container: full width real del panel */}
      <div className="px-4 md:px-6">
        {/* Fila 1 */}
        <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
              f
            </span>
            <div className="min-w-0">
              <h2 className="text-lg md:text-xl font-semibold leading-tight truncate">Meta Ads</h2>
              <p className="text-xs md:text-sm text-muted-foreground truncate">
                Análisis de campañas de Facebook &amp; Instagram
              </p>
            </div>
          </div>

          {/* Objetivos */}
          <div className="w-full md:w-auto">
            <div
              className={[
                "inline-flex w-full md:w-auto rounded-2xl border bg-muted/30 p-1",
                "overflow-x-auto",
                "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              ].join(" ")}
            >
              {(["ventas", "alcance", "leads"] as Objective[]).map((key) => {
                const active = objective === key;
                return (
                  <Button
                    key={key}
                    size="sm"
                    variant={active ? "default" : "ghost"}
                    className={`rounded-xl px-3 whitespace-nowrap ${active ? "shadow-sm" : ""}`}
                    onClick={() => handleObjective(key)}
                  >
                    <span className="md:hidden">{OBJECTIVE_LABEL_SHORT[key]}</span>
                    <span className="hidden md:inline">{OBJECTIVE_LABEL[key]}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Fila 2 */}
        <div className="flex flex-col gap-3 pb-4 md:flex-row md:items-center md:justify-between">
          {/* Izquierda */}
          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 w-full md:w-auto justify-start">
                  <Calendar className="h-4 w-4" />
                  <span className="truncate">{currentRangeLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Rangos rápidos</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {DATE_RANGES.map((r) => (
                  <DropdownMenuItem
                    key={r.preset}
                    onClick={() => handleRangePreset(r.preset)}
                    className={r.preset === datePreset ? "bg-muted" : ""}
                  >
                    {r.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 w-full md:w-auto">
              <label htmlFor="include-today" className="text-sm">
                Incluir hoy
              </label>
              <Switch id="include-today" checked={includeToday} onCheckedChange={handleIncludeToday} />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 w-full md:w-auto justify-start">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filtro
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {CAMPAIGN_FILTERS.map((f) => (
                  <DropdownMenuItem
                    key={f.value}
                    onClick={() => handleCampaignFilter(f.value)}
                    className={campaignFilter === f.value ? "font-medium" : ""}
                  >
                    {f.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Derecha */}
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
            <AccountsCombobox
              accounts={normalizedAccounts}
              value={urlAccountId || normalizeActId(defaultAccountId) || ""}
              onChange={handleAccountChange}
              disabled={accLoading || !normalizedAccounts.length}
              loading={accLoading}
            />

            <Button
              onClick={doRefresh}
              size="sm"
              className="gap-2 w-full md:w-auto justify-center"
              disabled={accLoading}
            >
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
        </div>

        <div className="pb-3 text-xs text-muted-foreground">
          Rango: {currentRangeLabel}
          {includeToday ? " (incluye hoy)" : ""} · Cuenta: {urlAccountId ? `act_${urlAccountId}` : "—"}
        </div>
      </div>
    </div>
  );
};

export default MetaAdsHeader;
