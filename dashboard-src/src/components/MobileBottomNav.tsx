// dashboard-src/src/components/MobileBottomNav.tsx
import React from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Settings, LogOut, Plus, Compass, ChartColumn } from "lucide-react";

import adrayLogo from "@/assets/adray-icon.png";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

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
  { label: "Attribution", to: ROUTES.attribution, icon: <ChartColumn className="h-5 w-5" /> },
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
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = isActive(pathname, item.to);
  const isStart = item.to === START_PATH;

  const rowClass = [
    "group relative flex items-center gap-3 overflow-hidden rounded-[22px] border px-4 py-3.5 transition-all duration-300 outline-none",
    active
      ? "border-[#B55CFF]/35 bg-[linear-gradient(135deg,rgba(181,92,255,0.16),rgba(255,255,255,0.05))] text-white shadow-[0_0_26px_rgba(181,92,255,0.12)]"
      : isStart
        ? "border-[#B55CFF]/24 bg-[linear-gradient(135deg,rgba(181,92,255,0.12),rgba(79,227,193,0.04))] text-white/92 shadow-[0_0_24px_rgba(181,92,255,0.08)] hover:border-[#B55CFF]/34 hover:shadow-[0_0_32px_rgba(181,92,255,0.12)]"
        : "border-white/10 bg-white/[0.04] text-white/82 hover:border-white/16 hover:bg-white/[0.06]",
  ].join(" ");

  const iconClass = [
    "relative z-[1] shrink-0 rounded-2xl border p-2.5 transition-all duration-300",
    active
      ? "border-[#B55CFF]/24 bg-[#B55CFF]/10 text-[#E9D6FF]"
      : isStart
        ? "border-[#B55CFF]/18 bg-[#B55CFF]/8 text-[#E9D6FF]"
        : "border-white/10 bg-white/[0.03] text-white/72",
  ].join(" ");

  const endDot = isStart ? (
    <span className="ml-auto inline-flex items-center">
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D97CFF]/25" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#D946EF]" />
      </span>
    </span>
  ) : null;

  const content = (
    <>
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.05),transparent)] translate-x-[-120%] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-hover:animate-[adray-shimmer_3.4s_ease-in-out_infinite]" />
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
      <span className={iconClass}>{item.icon}</span>
      <span className="relative z-[1] text-sm font-medium">{item.label}</span>
      {endDot}
    </>
  );

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

                    <SheetHeader className="relative shrink-0 px-4 pt-4">
                      <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/10" />

                      <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.88)_0%,rgba(10,10,14,0.96)_100%)] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.34)]">
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_90%_at_15%_0%,rgba(181,92,255,0.16),transparent_62%),radial-gradient(40%_70%_at_85%_18%,rgba(79,227,193,0.08),transparent_60%)]" />
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />

                        <div className="relative flex items-center justify-between gap-3">
                          <div className="min-w-0 flex items-center gap-3">
                            <img
                              src={adrayLogo}
                              alt="Adray"
                              draggable={false}
                              className="h-10 w-auto shrink-0 select-none object-contain"
                              style={{ filter: "drop-shadow(0 0 18px rgba(181,92,255,0.34))" }}
                            />

                            <SheetTitle className="truncate text-left text-[1.65rem] font-bold tracking-[-0.03em] text-white">
                              Navigation
                            </SheetTitle>
                          </div>

                          <SheetClose asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="relative shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] text-white/82 hover:bg-white/[0.08]"
                              aria-label="Close menu"
                            >
                              <span className="text-2xl leading-none">×</span>
                            </Button>
                          </SheetClose>
                        </div>
                      </div>
                    </SheetHeader>

                    <div
                      className="relative flex-1 overflow-y-auto px-4 pt-3"
                      style={{
                        paddingBottom: "calc(env(safe-area-inset-bottom) + 132px)",
                        WebkitOverflowScrolling: "touch",
                      }}
                    >
                      <div className="grid gap-3">
                        {MENU.map((item) => (
                          <MenuRow key={item.to} item={item} pathname={pathname} onNavigate={() => setOpen(false)} />
                        ))}
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
    </div>
  );
}
