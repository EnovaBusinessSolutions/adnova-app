//  dashboard-src/src/components/Sidebar.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Globe,
  Activity,
  Search,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  FileText,
  LogOut,
  AlertTriangle,
  Compass,
  Infinity,
  Sparkles,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";

// Tooltip (shadcn/ui)
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import adrayLogo from "@/assets/adray-logo.png";

export interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

type NavItem = {
  icon: React.ReactNode;
  label: string;
  path: string;
  external?: boolean;
  badge?: (opts: { isOpen: boolean }) => React.ReactNode;
};

const START_PATH = "/";
const PIXEL_PATH = "/pixel-checker";

/** Badge PRO para Creative Intelligence */
function ProBadge({ isOpen }: { isOpen: boolean }) {
  const GOLD = "#F59E0B";
  const GOLD_SOFT = "rgba(245,158,11,0.18)";

  if (!isOpen) {
    return (
      <span className="ml-0 inline-flex items-center">
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded text-[8px] font-bold"
          style={{
            background: `linear-gradient(135deg, ${GOLD} 0%, #FCD34D 100%)`,
            color: "#1A1622",
            boxShadow: `0 0 8px ${GOLD_SOFT}`,
          }}
        >
          P
        </span>
      </span>
    );
  }

  return (
    <span className="ml-auto inline-flex items-center">
      <span
        className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide"
        style={{
          background: `linear-gradient(135deg, ${GOLD} 0%, #FCD34D 100%)`,
          color: "#1A1622",
          boxShadow: `0 0 12px ${GOLD_SOFT}`,
        }}
      >
        PRO
      </span>
    </span>
  );
}

const PRIMARY: NavItem[] = [
  { icon: <Compass className="h-5 w-5" />, label: "Empieza aquí", path: START_PATH },

  // ✅ Meta Ads: icono tipo "∞"
  { icon: <Infinity className="h-5 w-5" />, label: "Meta Ads", path: "/meta-ads" },

  // ✅ Creative Intelligence (PRO)
  {
    icon: <Sparkles className="h-5 w-5" />,
    label: "Creative Intelligence",
    path: "/creative-intelligence",
    badge: ProBadge,
  },

  { icon: <Search className="h-5 w-5" />, label: "Google Ads", path: "/google-ads" },
  { icon: <BarChart3 className="h-5 w-5" />, label: "Google Analytics", path: "/google-analytics" },

  // ✅ “Nuevo” + mismo efecto que Empieza aquí
  { icon: <Activity className="h-5 w-5" />, label: "Auditor de Píxeles", path: PIXEL_PATH },

  { icon: <Globe className="h-5 w-5" />, label: "Auditorías con IA", path: "/site-audit" },
];

const SECONDARY: NavItem[] = [
  { icon: <Settings className="h-5 w-5" />, label: "Configuración", path: "/settings" },
];

const LOGOUT_PATH = "/logout";
const isAuditComingSoon = false;

function isActivePath(pathname: string, target: string) {
  if (target === "/") return pathname === "/";
  return pathname === target || pathname.startsWith(`${target}/`) || pathname.startsWith(target);
}

/**
 * ✅ Badge “Nuevo” (igual que Empieza aquí)
 * REGLA UX:
 * - sidebar colapsado: NO mostrar nada
 * - sidebar abierto: ping + pill “Nuevo”
 */
function NewBadge({ isOpen }: { isOpen: boolean }) {
  if (!isOpen) return null;

  const PURPLE = "#D946EF";
  const PURPLE_SOFT = "rgba(217,70,239,0.18)";

  return (
    <span className="ml-auto inline-flex items-center gap-2">
      <span className="relative inline-flex h-3 w-3">
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full"
          style={{ background: PURPLE_SOFT }}
        />
        <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: PURPLE }} />
      </span>

      <span
        className={[
          "rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide",
          "border text-white/95",
          "animate-pulse",
        ].join(" ")}
        style={{
          borderColor: "rgba(217,70,239,0.55)",
          background: "rgba(217,70,239,0.22)",
          boxShadow: "0 0 18px rgba(217,70,239,0.22)",
        }}
      >
        Nuevo
      </span>
    </span>
  );
}

/**
 * ✅ Badge “Empieza aquí”
 * REGLA UX (como pediste):
 * - sidebar colapsado: NO mostrar punto morado
 * - sidebar abierto: ping + pill “Nuevo”
 */
function StartBadge({ isOpen }: { isOpen: boolean }) {
  if (!isOpen) return null;

  const PURPLE = "#D946EF";
  const PURPLE_SOFT = "rgba(217,70,239,0.18)";

  return (
    <span className="ml-auto inline-flex items-center gap-2">
      <span className="relative inline-flex h-3 w-3">
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full"
          style={{ background: PURPLE_SOFT }}
        />
        <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: PURPLE }} />
      </span>

      <span
        className={[
          "rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide",
          "border text-white/95",
          "animate-pulse",
        ].join(" ")}
        style={{
          borderColor: "rgba(217,70,239,0.55)",
          background: "rgba(217,70,239,0.22)",
          boxShadow: "0 0 18px rgba(217,70,239,0.22)",
        }}
      >
        Nuevo
      </span>
    </span>
  );
}

function RowShell({
  isOpen,
  active,
  children,
  onClick,
  emphasize,
}: {
  isOpen: boolean;
  active: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  emphasize?: boolean;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : -1}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      onClick={onClick}
      className={[
        "group flex w-full items-center rounded-xl transition-all duration-200 outline-none",
        "px-3 py-2.5",
        active
          ? "bg-gradient-to-r from-[#B55CFF] to-[#9D5BFF] shadow-[0_0_15px_rgba(181,92,255,0.25)]"
          : emphasize
          ? [
              "border",
              "bg-gradient-to-r from-[rgba(217,70,239,0.18)] to-[rgba(157,91,255,0.08)]",
              "border-[rgba(217,70,239,0.35)]",
              "shadow-[0_0_26px_rgba(217,70,239,0.20)]",
              "hover:shadow-[0_0_34px_rgba(217,70,239,0.28)]",
              "hover:border-[rgba(217,70,239,0.48)]",
              "focus-visible:ring-2 focus-visible:ring-[rgba(217,70,239,0.55)]",
            ].join(" ")
          : "hover:bg-[#2C2530] focus-visible:ring-2 focus-visible:ring-[#B55CFF]/50",
        !isOpen ? "justify-center" : "",
      ].join(" ")}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </div>
  );
}

function NavRow({
  item,
  isOpen,
  active,
  onLogout,
}: {
  item: NavItem;
  isOpen: boolean;
  active: boolean;
  onLogout?: () => void;
}) {
  const isStart = item.path === START_PATH;
  const isPixel = item.path === PIXEL_PATH;

  // ✅ “Empieza aquí” y “Auditor de Píxeles” comparten estética (texto/ícono suave)
  const isSpecial = isStart || isPixel;

  const iconWrapClass = [
    "h-5 w-5 shrink-0 flex items-center justify-center",
    active
      ? "text-white"
      : isSpecial
      ? "text-[#F1D6FF] group-hover:text-white"
      : "text-[#9A8CA8] group-hover:text-[#E5D3FF]",
  ].join(" ");

  // ✅ QUITAMOS truncate para que NO se recorte “Auditor de Píxeles”
  // Permitimos wrap si llegara a faltar espacio por badges.
  const labelClass = [
    "ml-3 text-sm font-medium",
    "flex-1 min-w-0",
    "whitespace-normal break-words leading-tight",
    active
      ? "text-white"
      : isSpecial
      ? "text-[#F1D6FF] group-hover:text-white"
      : "text-[#9A8CA8] group-hover:text-[#E5D3FF]",
  ].join(" ");

  const content = (
    <>
      <span className={iconWrapClass}>{item.icon}</span>
      {isOpen ? <span className={labelClass}>{item.label}</span> : null}

      {/* ✅ Badges */}
      {isStart ? (
        <StartBadge isOpen={isOpen} />
      ) : isPixel ? (
        <NewBadge isOpen={isOpen} />
      ) : item.badge ? (
        item.badge({ isOpen })
      ) : null}
    </>
  );

  // ✅ “glow/emphasize” igual para Empieza aquí y Auditor de Píxeles cuando NO están activos
  const emphasizeRow = (isStart || isPixel) && !active;

  if (item.path === LOGOUT_PATH) {
    const row = (
      <RowShell isOpen={isOpen} active={active} onClick={onLogout}>
        {content}
      </RowShell>
    );

    if (!isOpen) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{row}</TooltipTrigger>
          <TooltipContent side="right" align="center" className="bg-[#0B0B0D] border border-[#2C2530] text-[#E5D3FF]">
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }
    return row;
  }

  if (item.external) {
    const row = (
      <a href={item.path} className="block">
        <RowShell isOpen={isOpen} active={active} emphasize={emphasizeRow}>
          {content}
        </RowShell>
      </a>
    );

    if (!isOpen) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{row}</TooltipTrigger>
          <TooltipContent side="right" align="center" className="bg-[#0B0B0D] border border-[#2C2530] text-[#E5D3FF]">
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }
    return row;
  }

  const row = (
    <Link to={item.path} className="block">
      <RowShell isOpen={isOpen} active={active} emphasize={emphasizeRow}>
        {content}
      </RowShell>
    </Link>
  );

  if (!isOpen) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent
          side="right"
          align="center"
          className="bg-[#0B0B0D] border border-[#2C2530] text-[#E5D3FF] shadow-[0_0_20px_rgba(181,92,255,0.12)]"
        >
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return row;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle }) => {
  const location = useLocation();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(sessionStorage.getItem("email"));
  }, []);

  const pathname = location.pathname || "/";

  const auditItem: NavItem = useMemo(
    () => ({ icon: <FileText className="h-5 w-5" />, label: "Generar Auditoría IA", path: "/generate-audit" }),
    []
  );

  const logoutItem: NavItem = useMemo(
    () => ({ icon: <LogOut className="h-5 w-5" />, label: "Cerrar sesión", path: LOGOUT_PATH, external: true }),
    []
  );

  const handleLogout = async () => {
    try {
      await fetch(LOGOUT_PATH, { credentials: "include" });
    } catch {}
    sessionStorage.clear();
    window.location.href = "/dashboard";
  };

  return (
    <aside
      className={[
        "fixed left-0 top-0 z-50 h-full",
        "bg-[#15121A] border-r border-[#2C2530]",
        "transition-all duration-300",
        isOpen ? "w-64" : "w-16",
        "flex flex-col",
      ].join(" ")}
    >
      {/* HEADER (LOGO) */}
      <div className="border-b border-[#2C2530] pl-0 pr-3 py-3">
        <div className="relative flex items-center justify-between">
          {isOpen ? (
            <div className="flex items-center min-w-0 overflow-visible -ml-4 pointer-events-none">
              <img
                src={adrayLogo}
                alt="Adray"
                draggable={false}
                className="h-16 w-[360px] object-contain select-none pointer-events-none"
                style={{
                  transform: "translateX(-130px) scale(2.05)",
                  transformOrigin: "left center",
                  filter: "drop-shadow(0 0 18px rgba(181,92,255,0.36))",
                }}
              />
            </div>
          ) : (
            <div className="h-16 w-10" />
          )}

          <button
            onClick={onToggle}
            className="relative z-20 rounded-lg p-2 hover:bg-[#2C2530] transition-colors"
            aria-label="Toggle sidebar"
          >
            {isOpen ? (
              <ChevronLeft className="h-4 w-4 text-[#9A8CA8]" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[#9A8CA8]" />
            )}
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {PRIMARY.map((item) => (
          <NavRow key={item.path} item={item} isOpen={isOpen} active={isActivePath(pathname, item.path)} />
        ))}

        <div className="pt-2">
          {isAuditComingSoon ? (
            <div className="rounded-xl border border-[#2C2530] bg-[#1A1622] px-3 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-[#B095E4] mt-0.5" />
                {isOpen ? <div className="text-xs text-[#B095E4]">Estamos afinando la IA de auditorías.</div> : null}
              </div>

              <div className="mt-2 opacity-80">
                <RowShell isOpen={isOpen} active={false}>
                  <span className="h-5 w-5 shrink-0 text-[#6F6280]">
                    <FileText className="h-5 w-5" />
                  </span>
                  {isOpen && <span className="ml-3 text-sm font-medium text-[#6F6280]">Generar Auditoría IA</span>}
                </RowShell>
              </div>
            </div>
          ) : (
            <NavRow item={auditItem} isOpen={isOpen} active={isActivePath(pathname, auditItem.path)} />
          )}
        </div>

        <div className="pt-2 space-y-1">
          {SECONDARY.map((item) => (
            <NavRow key={item.path} item={item} isOpen={isOpen} active={isActivePath(pathname, item.path)} />
          ))}
        </div>

        <div className="pt-2">
          <NavRow item={logoutItem} isOpen={isOpen} active={false} onLogout={handleLogout} />
        </div>
      </nav>

      <div className="p-2">
        <div className="rounded-xl border border-[#2C2530] bg-[#0B0B0D] px-3 py-3">
          <div className={`flex items-center ${isOpen ? "justify-start" : "justify-center"}`}>
            <span className="h-2 w-2 rounded-full bg-[#EB2CFF] animate-pulse" />
            {isOpen && (
              <span className="ml-2 text-xs text-[#B095E4] font-semibold truncate">
                {email ?? "Cargando correo..."}
              </span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
