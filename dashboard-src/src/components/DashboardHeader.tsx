// src/components/DashboardHeader.tsx
import React, { useEffect, useState } from "react";
import { Calendar, ChevronDown, RotateCcw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

type Range = 30 | 60 | 90;
const VALID_RANGES: Range[] = [30, 60, 90];

function getRangeFromUrl(): Range {
  const sp = new URLSearchParams(window.location.search);
  const n = Number(sp.get("range"));
  return (VALID_RANGES.includes(n as Range) ? (n as Range) : 30);
}

function setRangeInUrl(range: Range) {
  const url = new URL(window.location.href);
  url.searchParams.set("range", String(range));
  window.history.replaceState({}, "", url.toString());
}

function applyRangeAndReload(range: Range) {
  setRangeInUrl(range);
  window.location.reload();
}

interface DashboardHeaderProps {
  // Mantén lastSync como hoy
  lastSync?: string;

  // ✅ Nuevos: para reutilizar el header en otras páginas
  title?: string;
  subtitle?: string;

  // ✅ Controla si se muestran controles (rango/refresh)
  showControls?: boolean;
  showRange?: boolean;
  showRefresh?: boolean;

  // ✅ Badge opcional (ej. "Próximamente")
  badge?: string;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  lastSync,
  title = "Panel de Control",
  subtitle = "Monitoreo en tiempo real de tus campañas",
  showControls = true,
  showRange = true,
  showRefresh = true,
  badge,
}) => {
  const [range, setRange] = useState<Range>(30);

  useEffect(() => {
    if (!showControls || !showRange) return;
    setRange(getRangeFromUrl());
  }, [showControls, showRange]);

  const handleSelectRange = (r: Range) => {
    if (r === range) return;
    setRange(r);
    applyRangeAndReload(r);
  };

  const handleRefresh = () => window.location.reload();

  return (
    <header className="border-b border-[#2C2530] bg-[#15121A] px-4 py-4 md:p-6">
      {/* ✅ Móvil: columna | Desktop: fila */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* Texto: min-w-0 evita overflow raro en layouts flex */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground leading-tight">
              {title}
            </h1>

            {badge ? (
              <Badge
                variant="secondary"
                className="border border-white/10 bg-white/[0.04] text-white/80"
              >
                {badge}
              </Badge>
            ) : null}
          </div>

          {subtitle ? (
            <p className="text-[#9A8CA8] text-sm mt-1">{subtitle}</p>
          ) : null}

          {/* lastSync: lo dejamos igual */}
          {lastSync ? (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70">
              <span className="h-2 w-2 rounded-full bg-[#B55CFF]" />
              Última sincronización: {lastSync}
            </div>
          ) : null}
        </div>

        {/* ✅ Controles opcionales */}
        {showControls ? (
          <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:items-center md:gap-4">
            {showRange ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between border-[#B55CFF] text-white hover:bg-[#2C2530] transition-colors"
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <Calendar className="w-4 h-4 text-[#B55CFF] shrink-0" />
                      <span className="text-sm truncate">{`Últimos ${range} días`}</span>
                    </span>
                    <ChevronDown className="w-4 h-4 text-[#9A8CA8] shrink-0" />
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="min-w-[180px]">
                  {VALID_RANGES.map((d) => (
                    <DropdownMenuItem
                      key={d}
                      onSelect={() => handleSelectRange(d)}
                      className="cursor-pointer"
                    >
                      {d === range ? (
                        <Check className="w-4 h-4 mr-2" />
                      ) : (
                        <span className="w-4 h-4 mr-2" />
                      )}
                      {`Últimos ${d} días`}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="hidden md:block" />
            )}

            {showRefresh ? (
              <Button
                onClick={handleRefresh}
                variant="outline"
                className="w-full border-[#B55CFF] text-[#B55CFF] hover:bg-[#B55CFF] hover:text-white transition-colors"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Actualizar
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
};
