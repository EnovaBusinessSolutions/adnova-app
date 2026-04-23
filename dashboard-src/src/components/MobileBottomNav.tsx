// dashboard-src/src/components/MobileBottomNav.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Settings, LogOut, Plus, Compass, ArrowRight, ChartColumn, Lock } from "lucide-react";

import adrayLogo from "@/assets/adray-icon.png";

import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ParticleField } from "@/components/ParticleField";
import { PixelSetupWizard } from "@/components/PixelSetupWizard";

type NavItem = {
  label: string;
  to: string;
  icon: React.ReactNode;
  external?: boolean;
};

const ROUTES = {
  start: "/",
  attribution: "/attribution",
  settings: "/settings",
};

const LOGOUT_HREF = "/logout";
const START_PATH = ROUTES.start;

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

const PRIMARY: NavItem[] = [
  { label: "Get started", to: ROUTES.start, icon: <Compass className="h-5 w-5" /> },
  { label: "Settings", to: ROUTES.settings, icon: <Settings className="h-5 w-5" /> },
];

const MENU: NavItem[] = [
  { label: "Get started", to: ROUTES.start, icon: <Compass className="h-5 w-5" /> },
  { label: "Attribution", to: ROUTES.attribution, icon: <ChartColumn className="h-5 w-5" /> },
  { label: "Settings", to: ROUTES.settings, icon: <Settings className="h-5 w-5" /> },
];

function BottomItem({
  active,
  to,
  icon,
  label,
}: {
  active: boolean;
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <NavLink to={withBase(to)} className="group flex flex-col items-center gap-1 px-2 py-1 text-[11px]">
      <span
        className={[
          "relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition-all duration-300",
          active
            ? "border-[#B55CFF]/35 bg-[#B55CFF]/10 text-[#E9D6FF] shadow-[0_0_22px_rgba(181,92,255,0.18)]"
            : "border-white/10 bg-white/[0.03] text-white/60 group-hover:border-white/15 group-hover:bg-white/[0.05] group-hover:text-white/82",
        ].join(" ")}
      >
        {active ? (
          <span className="pointer-events-none absolute inset-0 rounded-2xl bg-[linear-gradient(135deg,rgba(181,92,255,0.10),rgba(79,227,193,0.04))]" />
        ) : null}
        <span className="relative z-[1]">{icon}</span>
      </span>

      <span className={active ? "text-[#DDBBFF]" : "text-white/58 group-hover:text-white/76"}>{label}</span>
    </NavLink>
  );
}

function MenuRow({
  item,
  pathname,
  onNavigate,
  locked = false,
  lockedContent,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
  locked?: boolean;
  lockedContent?: React.ReactNode;
}) {
  const active = isActive(pathname, item.to);
  const isStart = item.to === START_PATH;

  const rowClass = [
    "group relative flex items-center gap-3 overflow-hidden rounded-[22px] border px-4 py-3.5 transition-all duration-300 outline-none",
    locked
      ? "cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-white/45"
      : active
        ? "border-[#B55CFF]/35 bg-[linear-gradient(135deg,rgba(181,92,255,0.16),rgba(255,255,255,0.05))] text-white shadow-[0_0_26px_rgba(181,92,255,0.12)]"
        : isStart
          ? "border-[#B55CFF]/24 bg-[linear-gradient(135deg,rgba(181,92,255,0.12),rgba(79,227,193,0.04))] text-white/92 shadow-[0_0_24px_rgba(181,92,255,0.08)] hover:border-[#B55CFF]/34 hover:shadow-[0_0_32px_rgba(181,92,255,0.12)]"
          : "border-white/10 bg-white/[0.04] text-white/82 hover:border-white/16 hover:bg-white/[0.06]",
  ].join(" ");

  const iconClass = [
    "relative z-[1] shrink-0 rounded-2xl border p-2.5 transition-all duration-300",
    locked
      ? "border-white/[0.06] bg-white/[0.02] text-white/35"
      : active
        ? "border-[#B55CFF]/24 bg-[#B55CFF]/10 text-[#E9D6FF]"
        : isStart
          ? "border-[#B55CFF]/18 bg-[#B55CFF]/8 text-[#E9D6FF]"
          : "border-white/10 bg-white/[0.03] text-white/72",
  ].join(" ");

  const endDot = !locked && isStart ? (
    <span className="ml-auto inline-flex items-center">
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D97CFF]/25" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#D946EF]" />
      </span>
    </span>
  ) : null;

  const lockBadge = locked ? (
    <span className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.04]">
      <Lock className="h-3 w-3 text-white/55" />
    </span>
  ) : null;

  const content = (
    <>
      {!locked && (
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.05),transparent)] translate-x-[-120%] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-hover:animate-[adray-shimmer_3.4s_ease-in-out_infinite]" />
      )}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
      <span className={iconClass}>{item.icon}</span>
      <span className="relative z-[1] text-sm font-medium">{item.label}</span>
      {lockBadge ?? endDot}
    </>
  );

  if (locked) {
    return (
      <HoverCard openDelay={150} closeDelay={120}>
        <HoverCardTrigger asChild>
          <div
            role="button"
            aria-disabled="true"
            tabIndex={0}
            className={rowClass}
            onClick={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") e.preventDefault();
            }}
          >
            {content}
          </div>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="center"
          sideOffset={12}
          className="w-[18rem] border border-white/10 bg-[#0B0B0D] p-0 text-white shadow-[0_0_28px_rgba(181,92,255,0.22)]"
        >
          {lockedContent}
        </HoverCardContent>
      </HoverCard>
    );
  }

  if (item.external) {
    return (
      <a href={item.to} onClick={onNavigate} className={rowClass}>
        {content}
      </a>
    );
  }

  return (
    <Link to={withBase(item.to)} onClick={onNavigate} className={rowClass}>
      {content}
    </Link>
  );
}

export default function MobileBottomNav() {
  const { pathname } = useLocation();
  const [open, setOpen] = React.useState(false);

  // Pixel connection state — mirrors the pattern used in Sidebar.tsx.
  // Optimistic from localStorage, confirmed by /api/onboarding/status.
  const [pixelConnected, setPixelConnected] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return !!localStorage.getItem("adray_analytics_shop");
  });
  const [pixelShop, setPixelShop] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("adray_analytics_shop");
  });
  const [pixelWizardOpen, setPixelWizardOpen] = useState(false);
  const pixelFetchInFlight = useRef(false);

  const refreshPixelStatus = useCallback(async () => {
    if (pixelFetchInFlight.current) return;
    pixelFetchInFlight.current = true;
    try {
      const res = await fetch("/api/onboarding/status", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      const connected = !!json?.status?.pixel?.connected;
      const shop: string | null = json?.status?.pixel?.shop ?? null;
      setPixelConnected(connected);
      setPixelShop(shop);
      if (typeof window !== "undefined" && connected && shop) {
        try { localStorage.setItem("adray_analytics_shop", shop); } catch { /* ignore */ }
      }
    } catch {
      // Keep optimistic state on failure.
    } finally {
      pixelFetchInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    refreshPixelStatus();
    const onFocus = () => { refreshPixelStatus(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshPixelStatus]);

  const left = PRIMARY[0];
  const right = PRIMARY[1];

  return (
    <div className="md:hidden">
      <div
        className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <div className="relative mx-auto max-w-md">
          <div className="pointer-events-none absolute inset-0 rounded-[30px] bg-[radial-gradient(55%_90%_at_50%_0%,rgba(181,92,255,0.18),transparent_70%),radial-gradient(35%_70%_at_85%_100%,rgba(79,227,193,0.10),transparent_75%)] blur-2xl" />

          <div className="relative overflow-visible rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(15,12,24,0.84)_0%,rgba(8,9,13,0.94)_100%)] shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/16 to-transparent" />

            <div className="relative flex h-[72px] items-end justify-between px-4 pb-2">
              <div className="flex w-[36%] justify-start pl-10">
                <BottomItem active={isActive(pathname, left.to)} to={left.to} icon={left.icon} label={left.label} />
              </div>

              <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2">
                <div className="h-10 w-24 rounded-b-[28px] bg-[radial-gradient(closest-side,rgba(181,92,255,0.12),transparent_72%)] blur-xl" />
              </div>

              <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[34%]">
                <Sheet open={open} onOpenChange={setOpen}>
                  <SheetTrigger asChild>
                    <Button
                      className="relative h-[64px] w-[64px] rounded-[22px] border border-white/10 text-white shadow-[0_18px_42px_rgba(181,92,255,0.30)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_24px_54px_rgba(181,92,255,0.36)]"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(200,124,255,1) 0%, rgba(181,92,255,1) 42%, rgba(126,87,255,1) 100%)",
                      }}
                      aria-label="Open menu"
                    >
                      <span className="pointer-events-none absolute inset-0 rounded-[22px] bg-[linear-gradient(180deg,rgba(255,255,255,0.12),transparent_35%)]" />
                      <span className="pointer-events-none absolute -inset-[1px] rounded-[22px] border border-white/10" />
                      <Plus className="relative z-[1] h-6 w-6" />
                    </Button>
                  </SheetTrigger>

                  <SheetContent
                    side="bottom"
                    className={[
                      "z-[101] h-[100dvh] max-h-[100dvh] border-white/10 p-0 text-white",
                      "bg-[linear-gradient(180deg,rgba(10,10,14,0.98)_0%,rgba(7,8,12,0.99)_100%)]",
                      "backdrop-blur-2xl",
                      "flex flex-col",
                      "[&>button.absolute]:hidden",
                    ].join(" ")}
                  >
                    <div className="pointer-events-none absolute inset-0">
                      <div className="absolute -top-16 left-[8%] h-64 w-64 rounded-full bg-[#B55CFF]/14 blur-3xl" />
                      <div className="absolute top-[16%] right-[6%] h-56 w-56 rounded-full bg-[#4FE3C1]/8 blur-3xl" />
                      <div className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(255,255,255,0.028)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.028)_1px,transparent_1px)] [background-size:42px_42px]" />
                    </div>

                    <ParticleField
                      variant="multiverse"
                      count={18}
                      className="pointer-events-none absolute inset-0 overflow-hidden"
                    />

                    <SheetHeader className="relative z-[1] shrink-0 px-4 pt-3">
                      {/* Handle bar iOS-style */}
                      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />

                      {/* Minimal top row: small logo chip + title + close */}
                      <div className="relative flex items-center gap-3">
                        {/* Logo chip */}
                        <span
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl"
                          style={{ boxShadow: "0 0 18px rgba(181,92,255,0.14)" }}
                        >
                          <img
                            src={adrayLogo}
                            alt="Adray"
                            draggable={false}
                            className="h-5 w-5 select-none object-contain"
                            style={{ filter: "drop-shadow(0 0 8px rgba(181,92,255,0.45))" }}
                          />
                        </span>

                        <SheetTitle className="min-w-0 flex-1 truncate text-left text-[1.35rem] font-semibold tracking-[-0.02em] text-white">
                          Navigation
                        </SheetTitle>

                        <SheetClose asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] text-white/70 backdrop-blur-xl hover:border-white/16 hover:bg-white/[0.08] hover:text-white"
                            aria-label="Close menu"
                          >
                            <span className="text-xl leading-none">×</span>
                          </Button>
                        </SheetClose>
                      </div>

                      {/* iOS-style chip row — displays the connected account / version at a glance */}
                      <div className="mt-3 flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-white/55 backdrop-blur-xl">
                          <span className="relative inline-flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4FE3C1]/40" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#4FE3C1]" />
                          </span>
                          Connected
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#B55CFF]/24 bg-[#B55CFF]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#D8B8FF] backdrop-blur-xl">
                          Adray
                        </span>
                      </div>

                      {/* Soft divider below header */}
                      <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                    </SheetHeader>

                    <div
                      className="relative z-[1] flex-1 overflow-y-auto px-4 pt-3"
                      style={{
                        paddingBottom: "calc(env(safe-area-inset-bottom) + 132px)",
                        WebkitOverflowScrolling: "touch",
                      }}
                    >
                      <div className="grid gap-3">
                        {MENU.map((item) => {
                          const isAttribution = item.to === ROUTES.attribution;
                          const locked = isAttribution && !pixelConnected;

                          return (
                            <MenuRow
                              key={item.to}
                              item={item}
                              pathname={pathname}
                              onNavigate={() => setOpen(false)}
                              locked={locked}
                              lockedContent={
                                locked ? (
                                  <div className="flex flex-col gap-3 p-4">
                                    <div className="flex items-center gap-2">
                                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#B55CFF]/30 bg-[#B55CFF]/12">
                                        <Lock className="h-3 w-3 text-[#D8B8FF]" />
                                      </span>
                                      <p className="text-[10px] uppercase tracking-[0.22em] text-[#E6D2FF]/70">
                                        Pixel required
                                      </p>
                                    </div>
                                    <p className="text-sm leading-6 text-white/85">
                                      Please connect the Adray Core pixel to activate this dashboard.
                                    </p>
                                    <Button
                                      onClick={() => {
                                        setOpen(false);
                                        setPixelWizardOpen(true);
                                      }}
                                      className="h-10 w-full rounded-xl bg-[#B55CFF] text-sm font-semibold text-white shadow-[0_0_22px_rgba(181,92,255,0.28)] transition-all hover:bg-[#A664FF] hover:shadow-[0_0_28px_rgba(181,92,255,0.36)]"
                                    >
                                      Connect
                                      <ArrowRight className="ml-2 h-4 w-4" />
                                    </Button>
                                  </div>
                                ) : undefined
                              }
                            />
                          );
                        })}
                      </div>

                      <a
                        href={LOGOUT_HREF}
                        className="group relative mt-4 flex items-center gap-3 overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3.5 text-white/84 transition-all duration-300 hover:border-white/16 hover:bg-white/[0.06]"
                        onClick={() => setOpen(false)}
                      >
                        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
                        <span className="rounded-2xl border border-white/10 bg-white/[0.03] p-2.5 text-[#D8B1FF]">
                          <LogOut className="h-5 w-5" />
                        </span>
                        <span className="text-sm font-medium">Sign out</span>
                      </a>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>

              <div className="flex w-[36%] justify-end pr-10">
                <BottomItem
                  active={isActive(pathname, right.to)}
                  to={right.to}
                  icon={right.icon}
                  label={right.label}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <PixelSetupWizard
        open={pixelWizardOpen}
        onOpenChange={(next) => {
          setPixelWizardOpen(next);
          if (!next) {
            window.setTimeout(() => { refreshPixelStatus(); }, 250);
          }
        }}
        currentShop={pixelShop || undefined}
      />
    </div>
  );
}