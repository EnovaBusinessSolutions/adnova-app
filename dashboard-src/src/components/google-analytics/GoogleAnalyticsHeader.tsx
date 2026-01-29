// dashboard-src/src/components/google-analytics/GoogleAnalyticsHeader.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router-dom";
import useGAProperties from "@/hooks/useGAProperties";

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

/* Combobox (shadcn) */
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

type Objective = "ventas" | "leads" | "adquisicion" | "engagement";

const OBJECTIVE_LABEL: Record<Objective, string> = {
  ventas: "Ventas",
  leads: "Leads",
  adquisicion: "Adquisición",
  engagement: "Engagement",
};

const OBJECTIVE_LABEL_SHORT: Record<Objective, string> = {
  ventas: "Ventas",
  leads: "Leads",
  adquisicion: "Adq.",
  engagement: "Eng.",
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

/* Compat si tu backend espera "dateRange" legacy */
function presetToLegacy(preset: string): string | undefined {
  switch (preset) {
    case "last_30d":
      return "last_30_days";
    case "last_7d":
      return "last_7_days";
    case "last_14d":
      return "last_14_days";
    case "last_28d":
      return "last_28_days";
    case "today":
      return "today";
    case "yesterday":
      return "yesterday";
    case "this_month":
      return "this_month";
    default:
      return undefined;
  }
}

/** Detecta móvil robusto (ancho o pointer coarse) */
function useIsMobileLike() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mqWidth = window.matchMedia("(max-width: 900px)");
    const mqCoarse = window.matchMedia("(pointer: coarse)");

    const calc = () => setIsMobile(Boolean(mqWidth.matches || mqCoarse.matches));
    calc();

    const onChange = () => calc();

    try {
      mqWidth.addEventListener("change", onChange);
      mqCoarse.addEventListener("change", onChange);
      return () => {
        mqWidth.removeEventListener("change", onChange);
        mqCoarse.removeEventListener("change", onChange);
      };
    } catch {
      mqWidth.addListener(onChange);
      mqCoarse.addListener(onChange);
      return () => {
        mqWidth.removeListener(onChange);
        mqCoarse.removeListener(onChange);
      };
    }
  }, []);

  return isMobile;
}

/** GAProperty */
type GAProperty = { id: string; label?: string; displayName?: string };

function getGaPropName(p?: GAProperty | null): string {
  if (!p) return "";
  if (p.displayName) return p.displayName;
  if (p.label) {
    const parts = p.label.split("—");
    return parts[0].trim();
  }
  return p.id;
}

/* =======================
   Combobox de Propiedades
======================= */
function PropertiesCombobox({
  properties,
  value,
  onChange,
  disabled,
  loading,
}: {
  properties: GAProperty[];
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const selected = properties.find((p) => p.id === value);
  const selectedName = getGaPropName(selected);
  const label = selectedName || (loading ? "Cargando propiedades..." : "Selecciona una propiedad GA4");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full md:w-[320px] justify-between"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] max-w-[calc(100vw-2rem)] p-0" align="end">
        <Command>
          <CommandInput placeholder="Buscar propiedad…" />
          <CommandEmpty>No se encontraron resultados.</CommandEmpty>
          <CommandList>
            <CommandGroup heading="Propiedades GA4">
              {properties
                .slice()
                .sort((a, b) => getGaPropName(a).localeCompare(getGaPropName(b)))
                .map((p) => {
                  const name = getGaPropName(p);
                  const selectedNow = p.id === value;

                  return (
                    <CommandItem
                      key={p.id}
                      value={`${name} ${p.id}`}
                      onSelect={() => {
                        onChange(p.id);
                        setOpen(false);
                      }}
                    >
                      <Check className={`mr-2 h-4 w-4 ${selectedNow ? "opacity-100" : "opacity-0"}`} />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm truncate">{name}</span>
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

const GoogleAnalyticsHeader: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobileLike();

  const { items, defaultPropertyId, loading: propsLoading } = useGAProperties();

  const gaProperties: GAProperty[] = useMemo(() => {
    return (items || [])
      .map((p: any) => ({
        id: p.id || p.propertyId || p.property_id,
        label: p.displayName || p.label || p.name,
        displayName: p.displayName,
      }))
      .filter((p: any) => !!p.id);
  }, [items]);

  // URL ↔ localStorage
  const urlProperty = params.get("property") || undefined;
  const lsProperty = typeof window !== "undefined" ? localStorage.getItem("ga_property") || undefined : undefined;

  const property = urlProperty || lsProperty || defaultPropertyId || "";

  useEffect(() => {
    // Si no hay property en URL, poner LS o default
    if (!urlProperty && (lsProperty || defaultPropertyId)) {
      const next = setParam(params, "property", (lsProperty || defaultPropertyId)!);
      setParams(next, { replace: true });
    }
    // Si viene por URL, persistimos
    if (urlProperty) localStorage.setItem("ga_property", urlProperty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlProperty, lsProperty, defaultPropertyId]);

  const datePreset = (params.get("date_preset") || "last_30d").toLowerCase();
  const includeToday = params.get("include_today") === "1";
  const objective = (params.get("objective") || "ventas") as Objective;

  const currentRangeLabel = useMemo(() => {
    return DATE_RANGES.find((r) => r.preset === datePreset)?.label || "Últimos 30 días";
  }, [datePreset]);

  const currentPropertyName = useMemo(() => {
    const found = gaProperties.find((p) => p.id === property);
    return getGaPropName(found) || "";
  }, [gaProperties, property]);

  const handleRangePreset = (preset: string) => {
    const patch: Record<string, string> = { date_preset: preset };

    // solo forzamos include_today para hoy/ayer
    if (preset === "today") patch.include_today = "1";
    if (preset === "yesterday") patch.include_today = "0";

    // compat legacy opcional
    const legacy = presetToLegacy(preset);
    if (legacy) patch.dateRange = legacy;

    setParams(patchParams(params, patch));
  };

  const handleIncludeToday = (checked: boolean) => {
    setParams(setParam(params, "include_today", checked ? "1" : "0"));
  };

  const handleObjective = (obj: Objective) => {
    setParams(setParam(params, "objective", obj));
  };

  const handlePropertyChange = (id: string) => {
    localStorage.setItem("ga_property", id);
    setParams(setParam(params, "property", id));
  };

  const doRefresh = () => {
    const next = setParam(params, "r", String(Date.now()));
    navigate(`${pathname}?${next.toString()}`, { replace: true });
  };

  return (
    <div
  data-ga-header="1"
  className={[
    "sticky top-0 z-20 md:z-[80]", // ✅ FIX: en móvil baja el z-index para que el menú quede encima
    "border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
    "pt-[env(safe-area-inset-top)]",
  ].join(" ")}
>
      <div className="px-4 md:px-6">
        {/* FILA 1: título + objetivos */}
        <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
              G
            </span>
            <div className="min-w-0">
              <h2 className="text-lg md:text-xl font-semibold leading-tight truncate">Google Analytics</h2>
              <p className="text-xs md:text-sm text-muted-foreground truncate">
                Métricas de comportamiento y conversión
              </p>
            </div>
          </div>

          {/* Objetivo: scrolleable en móvil para evitar overflow */}
          <div className="w-full md:w-auto">
            <div
              className={[
                "inline-flex w-full md:w-auto rounded-2xl border bg-muted/30 p-1",
                "overflow-x-auto",
                "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              ].join(" ")}
            >
              {(["ventas", "leads", "adquisicion", "engagement"] as Objective[]).map((key) => {
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

        {/* FILA 2: controles */}
        <div className="flex flex-col gap-3 pb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
            {/* Rango */}
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

            {/* Incluir hoy */}
            <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 w-full md:w-auto">
              <label htmlFor="include-today" className="text-sm">
                Incluir hoy
              </label>
              <Switch id="include-today" checked={includeToday} onCheckedChange={handleIncludeToday} />
            </div>

            {/* Filtro */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 w-full md:w-auto justify-start">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filtro
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem disabled>Sin filtros definidos</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
            <PropertiesCombobox
              properties={gaProperties}
              value={property}
              onChange={handlePropertyChange}
              disabled={propsLoading || !gaProperties.length}
              loading={propsLoading}
            />

            <Button onClick={doRefresh} size="sm" className="gap-2 w-full md:w-auto justify-center">
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
        </div>

        {/* Subinfo */}
        <div className="pb-3 text-xs text-muted-foreground">
          Rango: {currentRangeLabel}
          {includeToday ? " (incluye hoy)" : ""} · Propiedad: {currentPropertyName || "—"}
        </div>
      </div>
    </div>
  );
};

export default GoogleAnalyticsHeader;
