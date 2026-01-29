// dashboard-src/src/components/MobileBottomNav.tsx
import React from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  BarChart3,
  Search,
  ShieldCheck,
  FileText,
  Wand2,
  Settings,
  LogOut,
  Plus,
  Compass,
} from "lucide-react";

import adrayLogo from "@/assets/adray-logo.png";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type NavItem = {
  label: string;
  to: string;
  icon: React.ReactNode;
  external?: boolean;
};

/**
 * ✅ Rutas REALES según tu App.tsx
 */
const ROUTES = {
  start: "/",
  meta: "/meta-ads",
  googleAds: "/google-ads",
  ga4: "/google-analytics",
  pixel: "/pixel-checker",
  audits: "/site-audit",
  generateAudit: "/generate-audit",
  settings: "/settings",
};

// Logout (backend)
const LOGOUT_HREF = "/logout";

// Para comparar “Empieza aquí”
const START_PATH = ROUTES.start;

/** Estilo “glow/emphasize” como desktop para “Empieza aquí” cuando NO está activo */
const EMPHASIZE_ROW =
  "border border-[rgba(217,70,239,0.35)] " +
  "bg-gradient-to-r from-[rgba(217,70,239,0.18)] to-[rgba(157,91,255,0.08)] " +
  "shadow-[0_0_26px_rgba(217,70,239,0.20)] " +
  "hover:shadow-[0_0_34px_rgba(217,70,239,0.28)] " +
  "hover:border-[rgba(217,70,239,0.48)] " +
  "focus-visible:ring-2 focus-visible:ring-[rgba(217,70,239,0.55)]";

/** Ícono “Meta (∞)” inline (no depende de lucide) */
function MetaInfinityIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" aria-hidden="true">
      <path
        d="M18.5 44.5c-7.3 0-13.2-6-13.2-13.4S11.2 17.7 18.5 17.7c10.4 0 18.8 26.8 27 26.8 7.3 0 13.2-6 13.2-13.4S52.8 17.7 45.5 17.7c-10.4 0-18.8 26.8-27 26.8Z"
        stroke="currentColor"
        strokeWidth="5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Prefija rutas cuando el build corre bajo subpath (ej: /dashboard/) */
function withBase(path: string) {
  const raw = path.startsWith("/") ? path : `/${path}`;
  const base = (import.meta as any)?.env?.BASE_URL || "/";
  const baseClean = base === "/" ? "" : String(base).replace(/\/$/, "");
  if (!baseClean) return raw;
  if (raw === baseClean || raw.startsWith(baseClean + "/")) return raw;
  return `${baseClean}${raw}`;
}

function isActive(pathname: string, to: string) {
  const realTo = withBase(to);
  const root = withBase("/");
  if (realTo === root) return pathname === root;
  return pathname === realTo || pathname.startsWith(realTo + "/") || pathname.startsWith(realTo);
}

/**
 * Barra inferior (4 accesos):
 * - (izq) Auditorías, Meta
 * - (der) Google Ads, GA4
 *
 * ✅ Nombres alineados con desktop (captura)
 */
const PRIMARY: NavItem[] = [
  { label: "Auditorías", to: ROUTES.audits, icon: <FileText className="h-5 w-5" /> },
  { label: "Meta", to: ROUTES.meta, icon: <MetaInfinityIcon className="h-5 w-5" /> },
  { label: "Google Ads", to: ROUTES.googleAds, icon: <Search className="h-5 w-5" /> },
  { label: "GA4", to: ROUTES.ga4, icon: <BarChart3 className="h-5 w-5" /> },
];

/**
 * Menú completo (Sheet)
 * ✅ Orden alineado con desktop
 * ✅ Nombres alineados con desktop (captura)
 */
const MENU: NavItem[] = [
  { label: "Empieza aquí", to: ROUTES.start, icon: <Compass className="h-5 w-5" /> },
  { label: "Meta Ads", to: ROUTES.meta, icon: <MetaInfinityIcon className="h-5 w-5" /> },
  { label: "Google Ads", to: ROUTES.googleAds, icon: <Search className="h-5 w-5" /> },
  { label: "Google Analytics", to: ROUTES.ga4, icon: <BarChart3 className="h-5 w-5" /> },

  // ✅ Captura
  { label: "Auditor de Píxeles", to: ROUTES.pixel, icon: <ShieldCheck className="h-5 w-5" /> },
  { label: "Auditorías con IA", to: ROUTES.audits, icon: <FileText className="h-5 w-5" /> },
  { label: "Generar Auditoría IA", to: ROUTES.generateAudit, icon: <Wand2 className="h-5 w-5" /> },

  { label: "Configuración", to: ROUTES.settings, icon: <Settings className="h-5 w-5" /> },
];

export default function MobileBottomNav() {
  const { pathname } = useLocation();
  const [open, setOpen] = React.useState(false);

  const left = PRIMARY.slice(0, 2);
  const right = PRIMARY.slice(2);

  return (
    <div className="md:hidden">
      {/* Barra inferior */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#0B0B0D]/85 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="relative mx-auto flex h-16 items-center justify-between px-4">
          {/* Lado izquierdo */}
          <div className="flex flex-1 items-center justify-between">
            {left.map((item) => {
              const active = isActive(pathname, item.to);
              return (
                <NavLink
                  key={item.to}
                  to={withBase(item.to)}
                  className="flex flex-col items-center gap-1 px-2 py-2 text-[11px]"
                >
                  <span
                    className={[
                      "rounded-2xl p-2 transition",
                      active ? "bg-[#A96BFF]/15 text-[#C9A3FF]" : "text-white/60",
                    ].join(" ")}
                  >
                    {item.icon}
                  </span>
                  <span className={active ? "text-[#C9A3FF]" : "text-white/60"}>{item.label}</span>
                </NavLink>
              );
            })}
          </div>

          {/* Botón + (centro) */}
          <div className="relative -mt-10 flex w-20 justify-center">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  className="h-14 w-14 rounded-full shadow-lg shadow-black/40"
                  style={{ background: "linear-gradient(90deg, #A96BFF 0%, #9333ea 100%)" }}
                  aria-label="Abrir menú"
                >
                  <Plus className="h-6 w-6" />
                </Button>
              </SheetTrigger>

              <SheetContent
                side="bottom"
                className={[
                  "p-0 border-white/10 bg-[#0B0B0D]",
                  "z-[101]",
                  "h-[100dvh] max-h-[100dvh]",
                  "flex flex-col",
                  "pb-0",
                  // ✅ FIX DEFINITIVO: oculta el botón nativo del SheetContent (evita “doble X”)
                  "[&>button.absolute]:hidden",
                ].join(" ")}
              >
                {/* Header */}
                <SheetHeader className="px-4 pt-4 shrink-0">
                  <div className="flex items-center justify-between">
                    {/* ✅ Logo MÁS visible */}
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={adrayLogo}
                        alt="Adray"
                        draggable={false}
                        className="h-10 w-auto select-none object-contain"
                        style={{ filter: "drop-shadow(0 0 18px rgba(181,92,255,0.34))" }}
                      />
                      <SheetTitle className="text-white truncate">Menú</SheetTitle>
                    </div>

                    {/* ✅ Un solo botón de cerrar */}
                    <SheetClose asChild>
                      <Button variant="ghost" size="icon" className="text-white/80" aria-label="Cerrar menú">
                        <span className="text-2xl leading-none">×</span>
                      </Button>
                    </SheetClose>
                  </div>

                  <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-white/10" />
                </SheetHeader>

                {/* Contenido scrolleable */}
                <div
                  className="flex-1 overflow-y-auto px-4 pt-4"
                  style={{
                    paddingBottom: "calc(env(safe-area-inset-bottom) + 88px)",
                    WebkitOverflowScrolling: "touch",
                  }}
                >
                  <div className="grid gap-2">
                    {MENU.map((item) => {
                      const active = isActive(pathname, item.to);
                      const isStart = item.to === START_PATH;

                      const rowClass = [
                        "flex items-center gap-3 rounded-2xl border px-4 py-3 transition outline-none",
                        active
                          ? "border-[#A96BFF]/40 bg-[#A96BFF]/10 text-white"
                          : isStart
                          ? EMPHASIZE_ROW
                          : "border-white/10 bg-white/[0.04] text-white/85 hover:bg-white/[0.07]",
                      ].join(" ");

                      // ✅ Empieza aquí con color igual que desktop (más “claro”), resto en morado
                      const iconClass = ["shrink-0", isStart ? "text-[#F1D6FF]" : "text-[#A96BFF]"].join(" ");

                      // ✅ Ping + “Nuevo” (mismo efecto que desktop)
                      const startBadge = isStart ? (
                        <span className="ml-auto inline-flex items-center gap-2">
                          <span className="relative inline-flex h-2.5 w-2.5">
                            <span
                              className="absolute inline-flex h-full w-full animate-ping rounded-full"
                              style={{ background: "rgba(217,70,239,0.18)" }}
                            />
                            <span
                              className="relative inline-flex h-2.5 w-2.5 rounded-full"
                              style={{ background: "#D946EF" }}
                            />
                          </span>

                          <span
                            className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide border text-white/95 animate-pulse"
                            style={{
                              borderColor: "rgba(217,70,239,0.55)",
                              background: "rgba(217,70,239,0.22)",
                              boxShadow: "0 0 18px rgba(217,70,239,0.22)",
                            }}
                          >
                            Nuevo
                          </span>
                        </span>
                      ) : null;

                      if (item.external) {
                        return (
                          <a key={item.to} href={item.to} onClick={() => setOpen(false)} className={rowClass}>
                            <span className={iconClass}>{item.icon}</span>
                            <span className="text-sm font-medium">{item.label}</span>
                            {startBadge}
                          </a>
                        );
                      }

                      return (
                        <Link key={item.to} to={withBase(item.to)} onClick={() => setOpen(false)} className={rowClass}>
                          <span className={iconClass}>{item.icon}</span>
                          <span className="text-sm font-medium">{item.label}</span>
                          {startBadge}
                        </Link>
                      );
                    })}
                  </div>

                  {/* Logout */}
                  <a
                    href={LOGOUT_HREF}
                    className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white/85 transition hover:bg-white/[0.07]"
                    onClick={() => setOpen(false)}
                  >
                    <span className="text-[#A96BFF]">
                      <LogOut className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-medium">Cerrar Sesión</span>
                  </a>

                  <div className="mt-4 text-xs text-white/45">
                    Tip: este menú solo existe en móvil (<span className="text-white/70">md:hidden</span>), no afecta desktop.
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          {/* Lado derecho */}
          <div className="flex flex-1 items-center justify-between">
            {right.map((item) => {
              const active = isActive(pathname, item.to);
              return (
                <NavLink
                  key={item.to}
                  to={withBase(item.to)}
                  className="flex flex-col items-center gap-1 px-2 py-2 text-[11px]"
                >
                  <span
                    className={[
                      "rounded-2xl p-2 transition",
                      active ? "bg-[#A96BFF]/15 text-[#C9A3FF]" : "text-white/60",
                    ].join(" ")}
                  >
                    {item.icon}
                  </span>
                  <span className={active ? "text-[#C9A3FF]" : "text-white/60"}>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
