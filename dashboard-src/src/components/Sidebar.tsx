// dashboard-src/src/components/Sidebar.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Settings, ChevronLeft, ChevronRight, LogOut, Compass } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

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
const SETTINGS_PATH = "/settings";
const LOGOUT_PATH = "/logout";

const PRIMARY: NavItem[] = [{ icon: <Compass className="h-5 w-5" />, label: "Get started", path: START_PATH }];

const SECONDARY: NavItem[] = [{ icon: <Settings className="h-5 w-5" />, label: "Settings", path: SETTINGS_PATH }];

function isActivePath(pathname: string, target: string) {
  if (target === "/") return pathname === "/";
  return pathname === target || pathname.startsWith(`${target}/`) || pathname.startsWith(target);
}

function safeJsonParse(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned;
}

function getNameFromStoredObject(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;

  return (
    normalizeName(obj.name) ||
    normalizeName(obj.fullName) ||
    normalizeName(obj.full_name) ||
    normalizeName(obj.firstName && obj.lastName ? `${obj.firstName} ${obj.lastName}` : "") ||
    normalizeName(obj.first_name && obj.last_name ? `${obj.first_name} ${obj.last_name}` : "") ||
    normalizeName(obj.username) ||
    null
  );
}

function prettifyEmailLocalPart(email: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  const local = email.split("@")[0]?.trim();
  if (!local) return null;

  const pretty = local
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return pretty || null;
}

function truncateName(value: string | null, max = 20): string {
  if (!value) return "Your account";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function resolveDisplayName(): string | null {
  const directNameKeys = ["name", "userName", "username", "fullName", "full_name"];

  for (const key of directNameKeys) {
    const directValue = normalizeName(sessionStorage.getItem(key));
    if (directValue) return directValue;
  }

  const objectKeys = ["user", "authUser", "currentUser", "sessionUser", "profile"];

  for (const key of objectKeys) {
    const parsed = safeJsonParse(sessionStorage.getItem(key));
    const parsedName = getNameFromStoredObject(parsed);
    if (parsedName) return parsedName;
  }

  const localParsedKeys = ["user", "authUser", "currentUser", "sessionUser", "profile"];
  for (const key of localParsedKeys) {
    const parsed = safeJsonParse(localStorage.getItem(key));
    const parsedName = getNameFromStoredObject(parsed);
    if (parsedName) return parsedName;
  }

  const email =
    normalizeName(sessionStorage.getItem("email")) ||
    normalizeName(localStorage.getItem("email")) ||
    null;

  return prettifyEmailLocalPart(email);
}

async function fetchSessionDisplayName(): Promise<string | null> {
  try {
    const res = await fetch("/api/session", {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;

    const json = await res.json();
    const user = json?.user || json?.data?.user || json?.data || null;
    const name =
      normalizeName(user?.name) ||
      normalizeName(user?.fullName) ||
      normalizeName(user?.full_name) ||
      normalizeName(user?.displayName) ||
      normalizeName(user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : "");

    if (name) {
      try {
        sessionStorage.setItem("name", name);
      } catch {}
      return name;
    }

    return null;
  } catch {
    return null;
  }
}

function StartBadge({ isOpen }: { isOpen: boolean }) {
  if (!isOpen) return null;

  return (
    <span className="ml-auto inline-flex items-center gap-2">
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D946EF]/30" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#D946EF] shadow-[0_0_10px_rgba(217,70,239,0.75)]" />
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
        "group relative flex w-full items-center overflow-hidden rounded-2xl outline-none transition-all duration-300",
        "px-3 py-3",
        active
          ? [
              "border border-[#B55CFF]/30",
              "bg-[linear-gradient(90deg,rgba(181,92,255,0.24)_0%,rgba(157,91,255,0.18)_55%,rgba(181,92,255,0.10)_100%)]",
              "shadow-[0_0_24px_rgba(181,92,255,0.18)]",
            ].join(" ")
          : emphasize
            ? [
                "border border-[#B55CFF]/18",
                "bg-[linear-gradient(90deg,rgba(181,92,255,0.14)_0%,rgba(181,92,255,0.07)_100%)]",
                "hover:border-[#B55CFF]/28",
                "hover:bg-[linear-gradient(90deg,rgba(181,92,255,0.18)_0%,rgba(181,92,255,0.08)_100%)]",
                "hover:shadow-[0_0_22px_rgba(181,92,255,0.12)]",
                "focus-visible:ring-2 focus-visible:ring-[#B55CFF]/40",
              ].join(" ")
            : [
                "border border-transparent",
                "bg-white/[0.02]",
                "hover:border-white/10",
                "hover:bg-white/[0.045]",
                "focus-visible:ring-2 focus-visible:ring-[#B55CFF]/35",
              ].join(" "),
        !isOpen ? "justify-center" : "",
      ].join(" ")}
      aria-current={active ? "page" : undefined}
    >
      {active ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-[#D2A7FF] shadow-[0_0_12px_rgba(210,167,255,0.8)]" />
      ) : null}

      {!active ? (
        <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="absolute -left-8 top-1/2 h-24 w-24 -translate-y-1/2 rounded-full bg-[#B55CFF]/10 blur-2xl" />
        </span>
      ) : null}

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
  const isSpecial = isStart;

  const iconWrapClass = [
    "relative z-[1] flex h-5 w-5 shrink-0 items-center justify-center",
    active
      ? "text-white"
      : isSpecial
        ? "text-[#F1D6FF] group-hover:text-white"
        : "text-[#9A8CA8] group-hover:text-[#E5D3FF]",
  ].join(" ");

  const labelClass = [
    "relative z-[1] ml-3 flex-1 min-w-0 whitespace-nowrap truncate text-sm font-medium leading-none",
    active
      ? "text-white"
      : isSpecial
        ? "text-[#F1D6FF] group-hover:text-white"
        : "text-[#B3A6C3] group-hover:text-[#E5D3FF]",
  ].join(" ");

  const content = (
    <>
      <span className={iconWrapClass}>{item.icon}</span>
      {isOpen ? <span className={labelClass}>{item.label}</span> : null}
      {isStart ? <StartBadge isOpen={isOpen} /> : item.badge ? item.badge({ isOpen }) : null}
    </>
  );

  const emphasizeRow = isStart && !active;

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
          <TooltipContent
            side="right"
            align="center"
            className="border border-white/10 bg-[#0B0B0D] text-[#E5D3FF] shadow-[0_0_22px_rgba(181,92,255,0.10)]"
          >
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
          <TooltipContent
            side="right"
            align="center"
            className="border border-white/10 bg-[#0B0B0D] text-[#E5D3FF] shadow-[0_0_22px_rgba(181,92,255,0.10)]"
          >
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
          className="border border-white/10 bg-[#0B0B0D] text-[#E5D3FF] shadow-[0_0_22px_rgba(181,92,255,0.10)]"
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
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
  let cancelled = false;

  const syncDisplayName = async () => {
    const fromStorage = resolveDisplayName();
    if (fromStorage) {
      if (!cancelled) setDisplayName(fromStorage);
      return;
    }

    const fromSession = await fetchSessionDisplayName();
    if (!cancelled) {
      setDisplayName(fromSession);
    }
  };

  syncDisplayName();

  const handleStorageSync = () => {
    const fromStorage = resolveDisplayName();
    setDisplayName(fromStorage);
  };

  window.addEventListener("storage", handleStorageSync);
  window.addEventListener("focus", syncDisplayName);

  return () => {
    cancelled = true;
    window.removeEventListener("storage", handleStorageSync);
    window.removeEventListener("focus", syncDisplayName);
  };
}, []);

  const pathname = location.pathname || "/";

  const footerName = useMemo(() => truncateName(displayName, 20), [displayName]);

  const logoutItem: NavItem = {
    icon: <LogOut className="h-5 w-5" />,
    label: "Sign out",
    path: LOGOUT_PATH,
    external: true,
  };

  const handleLogout = async () => {
    try {
      await fetch(LOGOUT_PATH, { credentials: "include" });
    } catch {}
    sessionStorage.clear();
    localStorage.removeItem("user");
    localStorage.removeItem("authUser");
    localStorage.removeItem("currentUser");
    localStorage.removeItem("sessionUser");
    localStorage.removeItem("profile");
    window.location.href = "/dashboard";
  };

  return (
    <aside
      className={[
        "adray-sidebar-glass fixed left-0 top-0 z-50 h-full",
        "transition-all duration-300",
        isOpen ? "w-64" : "w-20",
        "flex flex-col",
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-[#B55CFF]/20 to-transparent" />
      <div className="pointer-events-none absolute left-0 top-0 h-40 w-full bg-[radial-gradient(circle_at_top_left,rgba(181,92,255,0.16),transparent_62%)] opacity-90" />

      <div className="relative border-b border-white/[0.06] px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          {isOpen ? (
            <div className="relative flex min-w-0 items-center overflow-visible -ml-3 pointer-events-none">
              <img
                src={adrayLogo}
                alt="Adray"
                draggable={false}
                className="h-16 w-[320px] object-contain select-none pointer-events-none"
                style={{
                  transform: "translateX(-108px) scale(1.78)",
                  transformOrigin: "left center",
                  filter: "drop-shadow(0 0 18px rgba(181,92,255,0.30))",
                }}
              />
            </div>
          ) : (
            <div className="flex h-16 flex-1 items-center justify-center" aria-hidden="true" />
          )}

          <button
            onClick={onToggle}
            className={[
              "relative z-20 inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-2 transition-all duration-200",
              "hover:border-[#B55CFF]/25 hover:bg-white/[0.06] hover:shadow-[0_0_18px_rgba(181,92,255,0.10)]",
            ].join(" ")}
            aria-label="Toggle sidebar"
          >
            {isOpen ? (
              <ChevronLeft className="h-4 w-4 text-[#A99BB8]" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[#A99BB8]" />
            )}
          </button>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {PRIMARY.map((item) => (
          <NavRow key={item.path} item={item} isOpen={isOpen} active={isActivePath(pathname, item.path)} />
        ))}

        <div className="pt-3">
          <div className="mb-3 h-px w-full bg-gradient-to-r from-transparent via-white/8 to-transparent" />
          <div className="space-y-1">
            {SECONDARY.map((item) => (
              <NavRow key={item.path} item={item} isOpen={isOpen} active={isActivePath(pathname, item.path)} />
            ))}
          </div>
        </div>

        <div className="pt-3">
          <div className="mb-3 h-px w-full bg-gradient-to-r from-transparent via-white/8 to-transparent" />
          <NavRow item={logoutItem} isOpen={isOpen} active={false} onLogout={handleLogout} />
        </div>
      </nav>

      <div className="p-3">
        <div className="adray-sidebar-footer-card overflow-hidden rounded-2xl px-3 py-3">
          <div className={`flex items-center ${isOpen ? "justify-start" : "justify-center"}`}>
            <span className="adray-sidebar-ambient-dot relative inline-flex h-2.5 w-2.5 rounded-full bg-[#EB2CFF] shadow-[0_0_12px_rgba(235,44,255,0.7)]">
              <span className="absolute inset-0 animate-ping rounded-full bg-[#EB2CFF]/30" />
            </span>

            {isOpen && (
              <span
                className="ml-2 max-w-[180px] truncate text-xs font-semibold text-[#BFA9E8]"
                title={displayName || "Your account"}
              >
                {footerName}
              </span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;