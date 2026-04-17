import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DashboardLayout } from "@/components/DashboardLayout";
import { PixelSetupWizard } from "@/components/PixelSetupWizard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Check,
  Sparkles,
  Infinity,
  Search,
  BarChart3,
  Settings2,
  Sparkle,
  CheckCircle2,
  ShoppingBag,
} from "lucide-react";
import { GoogleMerchantSelectorDialog } from "@/components/google/GoogleMerchantSelectorDialog";

async function apiJson<T>(url: string) {
  const r = await fetch(url, { credentials: "include" });
  const txt = await r.text();
  if (!r.ok) throw new Error(txt || `HTTP ${r.status}`);
  return JSON.parse(txt) as T;
}

async function apiPostJson<T>(url: string, body: any) {
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

type StepState = "done" | "locked" | "todo";
type PixelProvider = "meta" | "google_ads";

type OnboardingStatus = {
  ok: boolean;
  status: {
    meta: {
      connected: boolean;
      availableCount: number;
      selectedCount: number;
      requiredSelection: boolean;
      selected: string[];
      defaultAccountId: string | null;
      maxSelect: number;
    };
    googleAds: {
      connected: boolean;
      availableCount: number;
      selectedCount: number;
      requiredSelection: boolean;
      selected: string[];
      defaultCustomerId: string | null;
      maxSelect: number;
    };
    ga4: {
      connected: boolean;
      availableCount: number;
      selectedCount: number;
      requiredSelection: boolean;
      selected: string[];
      defaultPropertyId: string | null;
      maxSelect: number;
    };
    shopify?: { connected: boolean };
    merchant?: {
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
    pixel?: { connected: boolean; shop: string | null };
    pixels?: {
      meta?: {
        selected: boolean;
        confirmed: boolean;
        selectedId: string | null;
        selectedName: string | null;
        confirmedAt: string | null;
      };
      googleAds?: {
        selected: boolean;
        confirmed: boolean;
        selectedId: string | null;
        selectedName: string | null;
        confirmedAt: string | null;
      };
    };
    readyToContinue?: {
      meta?: boolean;
      googleAds?: boolean;
      ga4?: boolean;
    };
    readyToAnalyze?: {
      meta?: boolean;
      googleAds?: boolean;
      ga4?: boolean;
    };
  };
};

function getAppBase() {
  try {
    const p = window.location.pathname || "";
    if (p === "/dashboard" || p.startsWith("/dashboard/")) return "/dashboard";
    return "";
  } catch {
    return "";
  }
}

function getQS() {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

function replaceQS(next: URLSearchParams) {
  const qs = next.toString();
  const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
  window.history.replaceState({}, "", url);
}

type ConnectKind = "meta" | "google" | null;

function getConnectKindFromQS(qs: URLSearchParams): ConnectKind {
  if (qs.get("meta") === "ok") return "meta";
  if (qs.get("google") === "ok") return "google";
  if (qs.get("ga4") === "ok") return "google";
  if (qs.get("gads") === "ok") return "google";
  if (qs.get("ads") === "ok") return "google";
  return null;
}

function getSelectorFlagFromQS(qs: URLSearchParams): boolean {
  const all = qs.getAll("selector");
  const last = all.length ? String(all[all.length - 1]) : String(qs.get("selector") || "");
  return last === "1";
}

function cleanConnectFlagsFromQS() {
  const next = getQS();
  next.delete("meta");
  next.delete("google");
  next.delete("ga4");
  next.delete("gads");
  next.delete("ads");
  next.delete("selector");
  next.delete("product");
  replaceQS(next);
}

type ASMOnly = "all" | "meta" | "googleAds" | "googleGa" | "merchant";
type ASMRequired = { meta?: boolean; googleAds?: boolean; googleGa?: boolean; merchant?: boolean };

type PixelOnly = "metaPixel" | "googleConversion";
type PixelRequired = { metaPixel?: boolean; googleConversion?: boolean };

declare global {
  interface Window {
    ADNOVA_ASM?: {
      openAccountSelectModal?: (opts: any) => Promise<void> | void;
      openPixelSelectModal?: (opts: any) => Promise<void> | void;
    };
  }
}

function openAsmModal(detail: { only: ASMOnly; force?: boolean; showAll?: boolean; required?: ASMRequired }) {
  const payload = {
    only: detail.only || "all",
    force: detail.force !== false,
    showAll: !!detail.showAll,
    required: detail.required || {},
  };

  const tryDirect = () => {
    const fn = window.ADNOVA_ASM?.openAccountSelectModal;
    if (typeof fn === "function") {
      try {
        fn(payload);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };

  if (tryDirect()) return;

  const fire = () => {
    window.dispatchEvent(new CustomEvent("adnova:open-account-select", { detail: payload }));
    window.dispatchEvent(new CustomEvent("adray:open-account-select", { detail: payload }));
  };

  fire();

  let attempts = 0;
  const t = window.setInterval(() => {
    attempts += 1;
    if (tryDirect()) {
      clearInterval(t);
      return;
    }
    fire();
    if (attempts >= 10) clearInterval(t);
  }, 250);
}

function openPixelModal(detail: { only: PixelOnly; force?: boolean; showAll?: boolean; required?: PixelRequired }) {
  const payload = {
    only: detail.only,
    force: detail.force !== false,
    showAll: !!detail.showAll,
    required: detail.required || {},
  };

  const tryDirect = () => {
    const fn = window.ADNOVA_ASM?.openPixelSelectModal;
    if (typeof fn === "function") {
      try {
        fn(payload);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };

  if (tryDirect()) return;

  const fire = () => {
    window.dispatchEvent(new CustomEvent("adnova:open-pixel-select", { detail: payload }));
    window.dispatchEvent(new CustomEvent("adray:open-pixel-select", { detail: payload }));
  };

  fire();

  let attempts = 0;
  const t = window.setInterval(() => {
    attempts += 1;
    if (tryDirect()) {
      clearInterval(t);
      return;
    }
    fire();
    if (attempts >= 10) clearInterval(t);
  }, 250);
}

function Pill({ label, done }: { label: string; done?: boolean }) {
  return (
    <span
      className={[
        "relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] transition-all",
        done
          ? "border-[#B55CFF]/35 bg-[#B55CFF]/[0.10] text-white shadow-[0_0_18px_rgba(181,92,255,0.14)]"
          : "border-white/10 bg-white/[0.03] text-white/60",
      ].join(" ")}
    >
      {done ? <Check className="h-3.5 w-3.5 text-[#D2A7FF]" /> : null}
      {label}
    </span>
  );
}

function NeonStatus({
  state,
  lockedLabel,
  todoLabel,
}: {
  state: StepState;
  lockedLabel?: string;
  todoLabel?: string;
}) {
  if (state === "done") {
    return (
      <span className="relative inline-flex shrink-0 overflow-hidden rounded-full border border-[#B55CFF]/35 bg-[#B55CFF]/[0.10] px-2.5 py-1 text-[10.5px] text-white shadow-[0_0_16px_rgba(181,92,255,0.16)]">
        <span className="relative z-[1]">Completed</span>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.14),transparent)] translate-x-[-120%] animate-[adray-shimmer_3.4s_ease-in-out_infinite]"
        />
      </span>
    );
  }

  if (state === "locked") {
    return (
      <span className="inline-flex shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10.5px] text-white/50">
        {lockedLabel || "Locked"}
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10.5px] text-white/68">
      {todoLabel || "Pending"}
    </span>
  );
}

function StepProgress({ step }: { step: 1 | 2 }) {
  const isStep1 = step === 1;
  const isStep2 = step === 2;

  const pillBase =
    "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] transition-all backdrop-blur-md";

  const active =
    "border-[#B55CFF]/45 bg-[#B55CFF]/[0.12] text-white shadow-[0_0_18px_rgba(181,92,255,0.12)]";
  const done = "border-white/10 bg-white/[0.04] text-white/82";
  const pending = "border-white/10 bg-white/[0.02] text-white/52";

  return (
    <div className="no-scrollbar -mx-1 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      <span className={[pillBase, isStep1 ? active : done].join(" ")}>
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#B55CFF]" />
        Step 1: Activate Data
      </span>

      <span className={[pillBase, isStep2 ? active : pending].join(" ")}>
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#4FE3C1]" />
        Step 2: Use in AI
      </span>
    </div>
  );
}

function StepRow({
  index,
  icon,
  title,
  desc,
  state,
  lockedLabel,
  todoLabel,
  ctaLabel,
  onCta,
  ctaDisabled,
  accent = "purple",
}: {
  index: number;
  icon: JSX.Element;
  title: string;
  desc: string;
  state: StepState;
  lockedLabel?: string;
  todoLabel?: string;
  ctaLabel: string;
  onCta: () => void;
  ctaDisabled?: boolean;
  accent?: "purple" | "emerald" | "blue";
}) {
  const isDone = state === "done";
  const isLocked = state === "locked";

  const theme =
    accent === "emerald"
      ? {
          softBorder: "border-[#4FE3C1]/22",
          softGlow: "shadow-[0_0_22px_rgba(79,227,193,0.10)]",
          hoverBorder: "hover:border-[#4FE3C1]/32",
          hoverGlow: "hover:shadow-[0_0_28px_rgba(79,227,193,0.10)]",
          iconWrap: "border-[#4FE3C1]/24 bg-[#4FE3C1]/10",
          buttonDone:
            "border-[#4FE3C1]/35 bg-[#4FE3C1]/[0.14] text-white shadow-[0_0_18px_rgba(79,227,193,0.16)] hover:bg-[#4FE3C1]/[0.16]",
          glowTop: "bg-[#4FE3C1]/10",
          glowBottom: "bg-[#B55CFF]/8",
          beam: "from-[#4FE3C1]/14 via-white/[0.05] to-transparent",
        }
      : accent === "blue"
        ? {
            softBorder: "border-[#7CC8FF]/22",
            softGlow: "shadow-[0_0_22px_rgba(124,200,255,0.10)]",
            hoverBorder: "hover:border-[#7CC8FF]/32",
            hoverGlow: "hover:shadow-[0_0_28px_rgba(124,200,255,0.10)]",
            iconWrap: "border-[#7CC8FF]/24 bg-[#7CC8FF]/10",
            buttonDone:
              "border-[#7CC8FF]/35 bg-[#7CC8FF]/[0.14] text-white shadow-[0_0_18px_rgba(124,200,255,0.16)] hover:bg-[#7CC8FF]/[0.16]",
            glowTop: "bg-[#7CC8FF]/10",
            glowBottom: "bg-[#B55CFF]/8",
            beam: "from-[#7CC8FF]/14 via-white/[0.05] to-transparent",
          }
        : {
            softBorder: "border-[#B55CFF]/22",
            softGlow: "shadow-[0_0_22px_rgba(181,92,255,0.08)]",
            hoverBorder: "hover:border-[#B55CFF]/28",
            hoverGlow: "hover:shadow-[0_0_28px_rgba(181,92,255,0.08)]",
            iconWrap: "border-[#B55CFF]/28 bg-[#B55CFF]/10",
            buttonDone:
              "border-[#B55CFF]/38 bg-[#B55CFF]/[0.14] text-white shadow-[0_0_18px_rgba(181,92,255,0.18)] hover:bg-[#B55CFF]/[0.16]",
            glowTop: "bg-[#B55CFF]/10",
            glowBottom: "bg-[#4FE3C1]/8",
            beam: "from-[#B55CFF]/14 via-white/[0.05] to-transparent",
          };

  return (
    <div
      className={[
        "group relative overflow-hidden rounded-[26px] border p-4 sm:rounded-[30px] sm:p-5 transition-all backdrop-blur-md",
        "bg-[linear-gradient(180deg,rgba(18,14,28,0.70)_0%,rgba(12,12,16,0.86)_100%)]",
        isDone
          ? `${theme.softBorder} ${theme.softGlow}`
          : isLocked
            ? "border-white/[0.06]"
            : `border-white/10 ${theme.hoverBorder} ${theme.hoverGlow}`,
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className={["absolute -top-16 right-0 h-44 w-44 rounded-full blur-3xl", theme.glowTop].join(" ")} />
        <div className={["absolute -bottom-16 left-0 h-40 w-40 rounded-full blur-3xl", theme.glowBottom].join(" ")} />
        <div className={`absolute inset-y-0 left-0 w-[42%] bg-gradient-to-r ${theme.beam} opacity-80`} />
      </div>

      <div className="pointer-events-none absolute inset-0 rounded-[26px] border border-white/[0.03] sm:rounded-[30px]" />

      <div className="relative hidden sm:flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={[
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border backdrop-blur-md",
              isDone ? theme.iconWrap : "border-white/10 bg-white/[0.03]",
            ].join(" ")}
          >
            {icon}
          </div>

          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-xs text-white/26">{index}</span>
              <p className="truncate text-sm font-semibold text-white/92">{title}</p>
              <NeonStatus state={state} lockedLabel={lockedLabel} todoLabel={todoLabel} />
            </div>

            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-white/56">{desc}</p>
          </div>
        </div>

        <Button
          variant="outline"
          disabled={isLocked || !!ctaDisabled}
          onClick={onCta}
          className={[
            "h-11 shrink-0 rounded-2xl border px-4 backdrop-blur-md",
            "disabled:opacity-100 disabled:cursor-default",
            isDone && !!ctaDisabled
              ? theme.buttonDone
              : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]",
          ].join(" ")}
        >
          {ctaLabel}
          {!(isDone && !!ctaDisabled) ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
        </Button>
      </div>

      <div className="relative sm:hidden">
        <div className="flex items-start gap-3">
          <div
            className={[
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border backdrop-blur-md",
              isDone ? theme.iconWrap : "border-white/10 bg-white/[0.03]",
            ].join(" ")}
          >
            {icon}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-xs text-white/26">{index}</span>
              <p className="truncate text-sm font-semibold text-white/92">{title}</p>
            </div>

            <div className="mt-2">
              <NeonStatus state={state} lockedLabel={lockedLabel} todoLabel={todoLabel} />
            </div>

            <p className="mt-2 text-sm leading-6 text-white/56">{desc}</p>
          </div>
        </div>

        <div className="mt-4">
          <Button
            variant="outline"
            disabled={isLocked || !!ctaDisabled}
            onClick={onCta}
            className={[
              "h-11 w-full justify-center rounded-2xl border backdrop-blur-md",
              "disabled:opacity-100 disabled:cursor-default",
              isDone && !!ctaDisabled
                ? theme.buttonDone
                : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]",
            ].join(" ")}
          >
            {ctaLabel}
            {!(isDone && !!ctaDisabled) ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Index() {
  const nav = useNavigate();

  const [loadingConnections, setLoadingConnections] = useState(true);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [asmUiLoading, setAsmUiLoading] = useState(false);
  const [asmUiError, setAsmUiError] = useState<string | null>(null);
  const [pixelWizardOpen, setPixelWizardOpen] = useState(false);
  const [merchantSelectorOpen, setMerchantSelectorOpen] = useState(false);

  const refreshConnections = async () => {
    setLoadingConnections(true);
    try {
      const st = await apiJson<OnboardingStatus>("/api/onboarding/status");
      setStatus(st);
      return st;
    } catch {
      setStatus(null);
      return null;
    } finally {
      setLoadingConnections(false);
    }
  };

  useEffect(() => {
    refreshConnections();
  }, []);

  const st = status?.status;

  const metaConnected = !!st?.meta?.connected;
  const googleAdsConnected = !!st?.googleAds?.connected;
  const ga4Connected = !!st?.ga4?.connected;

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

  // Pixel setup: true when wizard was completed (user.shop set on backend)
  // Also check localStorage as instant fallback before first API response
  const pixelConnected = !!(
    st?.pixel?.connected ||
    (typeof window !== "undefined" && !!localStorage.getItem("adray_analytics_shop"))
  );
  const pixelShop = st?.pixel?.shop || (typeof window !== "undefined" ? localStorage.getItem("adray_analytics_shop") : null);

  const hasMetaSelection = (st?.meta?.selectedCount || 0) > 0 || !!st?.meta?.defaultAccountId;
  const hasAdsSelection = (st?.googleAds?.selectedCount || 0) > 0 || !!st?.googleAds?.defaultCustomerId;
  const hasGa4Selection = (st?.ga4?.selectedCount || 0) > 0 || !!st?.ga4?.defaultPropertyId;

  const metaPixelSelected = !!st?.pixels?.meta?.selected;
  const metaPixelConfirmed = !!st?.pixels?.meta?.confirmed;

  const googleConvSelected = !!st?.pixels?.googleAds?.selected;
  const googleConvConfirmed = !!st?.pixels?.googleAds?.confirmed;

  const metaReadyToContinue = !!st?.readyToContinue?.meta;
  const adsReadyToContinue = !!st?.readyToContinue?.googleAds;
  const gaReadyToContinue = !!st?.readyToContinue?.ga4;

  const metaReadyToAnalyze = !!st?.readyToAnalyze?.meta;
  const adsReadyToAnalyze = !!st?.readyToAnalyze?.googleAds;
  const gaReadyToAnalyze = !!st?.readyToAnalyze?.ga4;

  const metaReady =
    metaReadyToAnalyze ||
    metaReadyToContinue ||
    (metaConnected && hasMetaSelection && metaPixelConfirmed);

  const adsReady =
    adsReadyToAnalyze ||
    adsReadyToContinue ||
    (googleAdsConnected && hasAdsSelection && googleConvConfirmed);

  const gaReady =
    gaReadyToAnalyze ||
    gaReadyToContinue ||
    (ga4Connected && hasGa4Selection);

  const anyReady = metaReady || adsReady || gaReady;

  const requiredSelectionSafe = useMemo(() => {
    const meta =
      !!st?.meta?.requiredSelection ||
      ((st?.meta?.availableCount || 0) > 1 && (st?.meta?.selectedCount || 0) === 0);
    const googleAds =
      !!st?.googleAds?.requiredSelection ||
      ((st?.googleAds?.availableCount || 0) > 1 && (st?.googleAds?.selectedCount || 0) === 0);
    const ga4 =
      !!st?.ga4?.requiredSelection ||
      ((st?.ga4?.availableCount || 0) > 1 && (st?.ga4?.selectedCount || 0) === 0);

    const merchant = !!st?.merchant?.requiredSelection ||
      ((st?.merchant?.availableCount || 0) > 1 && (st?.merchant?.selectedCount || 0) === 0);
    return { meta, googleAds, ga4, merchant };
  }, [st]);

  const mustPickAnything = useMemo(() => {
    return requiredSelectionSafe.meta || requiredSelectionSafe.googleAds || requiredSelectionSafe.ga4 || requiredSelectionSafe.merchant;
  }, [requiredSelectionSafe]);

  const hasMetaMulti = (st?.meta?.availableCount || 0) > 1;
  const hasAdsMulti = (st?.googleAds?.availableCount || 0) > 1;
  const hasGa4Multi = (st?.ga4?.availableCount || 0) > 1;

  const base = getAppBase();

  const connectReturnToMeta = `${base}/?selector=1&meta=ok`;
  const connectMetaUrl = `/auth/meta/login?returnTo=${encodeURIComponent(connectReturnToMeta)}`;

  const connectReturnToGoogleAds = `${base}/?selector=1&google=ok&product=ads`;
  const connectGoogleAdsUrl = `/auth/google/ads/connect?returnTo=${encodeURIComponent(connectReturnToGoogleAds)}`;

  const connectReturnToGoogleGa4 = `${base}/?selector=1&google=ok&product=ga4`;
  const connectGoogleGa4Url = `/auth/google/ga/connect?returnTo=${encodeURIComponent(connectReturnToGoogleGa4)}`;

  const openSelectorFor = async (only: ASMOnly, required?: ASMRequired, showAll = false) => {
    if (only === "merchant") {
      setMerchantSelectorOpen(true);
      return;
    }
    setAsmUiError(null);
    setAsmUiLoading(true);
    try {
      openAsmModal({
        only,
        force: true,
        showAll,
        required: required || {},
      });
    } catch (e: any) {
      setAsmUiError(e?.message || "Could not open the selector.");
    } finally {
      setTimeout(() => setAsmUiLoading(false), 300);
    }
  };

  const openPixelSelectorFor = async (only: PixelOnly) => {
    setAsmUiError(null);
    setAsmUiLoading(true);
    try {
      openPixelModal({
        only,
        force: true,
        showAll: true,
        required: only === "metaPixel" ? { metaPixel: true } : { googleConversion: true },
      });
    } catch (e: any) {
      setAsmUiError(e?.message || "Could not open the pixel selector.");
    } finally {
      setTimeout(() => setAsmUiLoading(false), 300);
    }
  };

  const confirmProvider = async (provider: PixelProvider) => {
    try {
      await apiPostJson("/api/pixels/confirm", { provider });
    } finally {
      await refreshConnections();
    }
  };

  const afterSelectionInGetStarted = async (opts?: { cleanQs?: boolean }) => {
    await refreshConnections();
    if (opts?.cleanQs) cleanConnectFlagsFromQS();
  };

  useEffect(() => {
    const onAccountsEvent = () => {
      afterSelectionInGetStarted({ cleanQs: false }).catch(console.error);
    };

    const onFinalEvent = () => {
      afterSelectionInGetStarted({ cleanQs: true }).catch(console.error);
    };

    const onResetEvent = () => {
      afterSelectionInGetStarted({ cleanQs: true }).catch(console.error);
    };

    const accountsEvents = [
      "adnova:accounts-selection-saved",
      "adray:accounts-selection-saved",
      "adnova:accounts-selection-not-needed",
      "adray:accounts-selection-not-needed",
    ];

    const finalEvents = [
      "adnova:pixels-selection-saved",
      "adray:pixels-selection-saved",
      "adnova:pixels-selection-not-needed",
      "adray:pixels-selection-not-needed",
      "adray:onboarding-flow-completed",
    ];

    const resetEvents = ["adray:onboarding-reset", "adnova:onboarding-reset"];

    accountsEvents.forEach((evt) => window.addEventListener(evt, onAccountsEvent as any));
    finalEvents.forEach((evt) => window.addEventListener(evt, onFinalEvent as any));
    resetEvents.forEach((evt) => window.addEventListener(evt, onResetEvent as any));

    return () => {
      accountsEvents.forEach((evt) => window.removeEventListener(evt, onAccountsEvent as any));
      finalEvents.forEach((evt) => window.removeEventListener(evt, onFinalEvent as any));
      resetEvents.forEach((evt) => window.removeEventListener(evt, onResetEvent as any));
    };
  }, []);

  const autoOpenedRef = useRef(false);

  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (loadingConnections) return;
    if (!status?.status) return;

    const qs = getQS();
    const selector = getSelectorFlagFromQS(qs);
    const kind = getConnectKindFromQS(qs);

    if (selector || kind) {
      autoOpenedRef.current = true;
      const product = (qs.get("product") || "").toLowerCase();
      if (selector && product === "merchant") {
        if (merchantNeedsPick) openSelectorFor("merchant", { merchant: true }, true);
      }
      return;
    }

    if (!mustPickAnything) return;

    autoOpenedRef.current = true;

    openAsmModal({
      only: "all",
      force: true,
      showAll: false,
      required: {
        meta: requiredSelectionSafe.meta,
        googleAds: requiredSelectionSafe.googleAds,
        googleGa: requiredSelectionSafe.ga4,
      },
    });
  }, [loadingConnections, status, mustPickAnything, requiredSelectionSafe, merchantNeedsPick]);

  const readyCtaRef = useRef<HTMLDivElement | null>(null);
  const didAutoScrollReadyRef = useRef(false);

  useEffect(() => {
    if (didAutoScrollReadyRef.current) return;
    if (loadingConnections) return;

    const isMobile = window.innerWidth < 768;
    if (!isMobile) return;
    if (!anyReady) return;

    const qs = getQS();
    const kind = getConnectKindFromQS(qs);
    if (!kind) return;

    didAutoScrollReadyRef.current = true;

    window.setTimeout(() => {
      readyCtaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);
  }, [loadingConnections, anyReady]);

  const totalCount = 3;

  const completedCount = useMemo(() => {
    return [metaReady, adsReady, gaReady].filter(Boolean).length;
  }, [metaReady, adsReady, gaReady]);

  const pct = useMemo(() => {
    if (!totalCount) return 0;
    return Math.round((completedCount / totalCount) * 100);
  }, [completedCount]);

  const heroTitle = "Connect Your Data Sources";

  const allReady = metaReady && adsReady && gaReady;
  const heroDesc = allReady
    ? "Your platforms are already synchronized."
    : "Sync your platforms to unlock complete AI insights.";

  const readyDesc = allReady
    ? "Your connected data is now available to power your AI insights."
    : "You can now use your connected data in your AI. Connect more sources to unlock deeper insights.";

  const steps = useMemo(() => {
    const metaNeedsPick = metaConnected && (requiredSelectionSafe.meta || (hasMetaMulti && !hasMetaSelection));
    const adsNeedsPick = googleAdsConnected && (requiredSelectionSafe.googleAds || (hasAdsMulti && !hasAdsSelection));
    const ga4NeedsPick = ga4Connected && (requiredSelectionSafe.ga4 || (hasGa4Multi && !hasGa4Selection));

    const metaCanSkipPixel = metaReadyToContinue && !metaPixelSelected && !metaPixelConfirmed;
    const adsCanSkipConversion = adsReadyToContinue && !googleConvSelected && !googleConvConfirmed;

    const metaNeedsPixel =
      metaConnected &&
      hasMetaSelection &&
      !metaReady &&
      !metaCanSkipPixel &&
      !metaPixelSelected;

    const adsNeedsConv =
      googleAdsConnected &&
      hasAdsSelection &&
      !adsReady &&
      !adsCanSkipConversion &&
      !googleConvSelected;

    const metaNeedsConfirm =
      metaConnected &&
      hasMetaSelection &&
      !metaReady &&
      metaPixelSelected &&
      !metaPixelConfirmed;

    const adsNeedsConfirm =
      googleAdsConnected &&
      hasAdsSelection &&
      !adsReady &&
      googleConvSelected &&
      !googleConvConfirmed;

    const metaIsPending = !metaReady;
    const adsIsPending = !adsReady;
    const gaIsPending = !gaReady;

    const metaCta = metaReady
      ? "Connected"
      : metaNeedsPick
        ? "Select"
        : metaNeedsPixel
          ? "Select"
          : metaNeedsConfirm
            ? "Continue"
            : "Connect";

    const adsCta = adsReady
      ? "Connected"
      : adsNeedsPick
        ? "Select"
        : adsNeedsConv
          ? "Select"
          : adsNeedsConfirm
            ? "Continue"
            : "Connect";

    const gaCta = gaReady ? "Connected" : ga4NeedsPick ? "Select" : "Connect";

    return [
      {
        key: "meta",
        title: "Meta Ads",
        desc: metaIsPending
          ? metaNeedsConfirm
            ? "Confirm your selection to finish setup."
            : metaNeedsPixel
              ? "Select your conversion pixel to complete the setup."
              : "Sync your Meta Ads account to unlock campaign and performance insights."
          : metaCanSkipPixel
            ? "Campaign and performance data are synced. You can activate a pixel later if needed."
            : "Campaign and performance data are synced and available for AI analysis.",
        icon: <Infinity className="h-4 w-4 text-[#B55CFF]" />,
        state: metaReady ? ("done" as StepState) : ("todo" as StepState),
        todoLabel: metaIsPending ? "Pending" : "Completed",
        ctaLabel: metaCta,
        ctaDisabled: metaReady,
        onCta: () => {
          if (metaReady) return;
          if (metaNeedsPick) return openSelectorFor("meta", { meta: true }, true);

          if (!metaConnected) {
            window.location.assign(connectMetaUrl);
            return;
          }

          if (metaNeedsPixel) return openPixelSelectorFor("metaPixel");
          if (metaNeedsConfirm) return confirmProvider("meta");

          return openSelectorFor("meta", { meta: true }, true);
        },
      },
      {
        key: "google_ads",
        title: "Google Ads",
        desc: adsIsPending
          ? adsNeedsConfirm
            ? "Confirm your conversion selection to finish setup."
            : adsNeedsConv
              ? "Select your conversion action to complete the setup."
              : "Sync your Google Ads account to unlock campaign and conversion insights."
          : adsCanSkipConversion
            ? "Campaign data is synced. You can activate a conversion later if needed."
            : "Campaign and conversion data are synced and ready for AI optimization.",
        icon: <Search className="h-4 w-4 text-[#B55CFF]" />,
        state: adsReady ? ("done" as StepState) : ("todo" as StepState),
        todoLabel: adsIsPending ? "Pending" : "Completed",
        ctaLabel: adsCta,
        ctaDisabled: adsReady,
        onCta: () => {
          if (adsReady) return;
          if (adsNeedsPick) return openSelectorFor("googleAds", { googleAds: true }, true);

          if (!googleAdsConnected) {
            window.location.assign(connectGoogleAdsUrl);
            return;
          }

          if (adsNeedsConv) return openPixelSelectorFor("googleConversion");
          if (adsNeedsConfirm) return confirmProvider("google_ads");

          return openSelectorFor("googleAds", { googleAds: true }, true);
        },
      },
      {
        key: "google_analytics",
        title: "Google Analytics",
        desc: gaIsPending
          ? "Connect GA4 to unlock session, event, and conversion insights."
          : "Session and conversion data are synced and powering your AI insights.",
        icon: <BarChart3 className="h-4 w-4 text-[#B55CFF]" />,
        state: gaReady ? ("done" as StepState) : ("todo" as StepState),
        todoLabel: gaIsPending ? "Pending" : "Completed",
        ctaLabel: gaCta,
        ctaDisabled: gaReady,
        onCta: () => {
          if (gaReady) return;
          if (ga4NeedsPick) return openSelectorFor("googleGa", { googleGa: true }, true);
          window.location.assign(connectGoogleGa4Url);
        },
      },
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
    ];
  }, [
    metaConnected,
    googleAdsConnected,
    ga4Connected,
    metaReady,
    adsReady,
    gaReady,
    requiredSelectionSafe,
    hasMetaMulti,
    hasAdsMulti,
    hasGa4Multi,
    hasMetaSelection,
    hasAdsSelection,
    hasGa4Selection,
    connectMetaUrl,
    connectGoogleAdsUrl,
    connectGoogleGa4Url,
    metaPixelSelected,
    metaPixelConfirmed,
    googleConvSelected,
    googleConvConfirmed,
    metaReadyToContinue,
    adsReadyToContinue,
    merchantConnected,
    merchantReady,
    merchantNeedsPick,
    connectGoogleMerchantUrl,
  ]);

  return (
  <>
    <DashboardLayout>
      <div className="min-h-screen overflow-x-hidden bg-[#050507]">
        <div className="overflow-x-hidden p-2.5 sm:p-6">
          <Card className="glass-effect mx-auto w-full max-w-full overflow-hidden rounded-[30px] border border-white/[0.06] shadow-[0_20px_80px_rgba(0,0,0,0.45)] sm:rounded-[34px]">
            <div className="relative">
              <div className="pointer-events-none absolute inset-0 opacity-70">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#B55CFF]/35 to-transparent" />
                <div className="absolute -top-20 left-[8%] h-72 w-72 rounded-full bg-[#B55CFF]/10 blur-3xl" />
                <div className="absolute top-[22%] right-[4%] h-72 w-72 rounded-full bg-[#4FE3C1]/8 blur-3xl" />
                <div className="absolute bottom-0 left-1/2 h-60 w-[44rem] -translate-x-1/2 rounded-full bg-[#B55CFF]/8 blur-3xl" />
              </div>

              <CardContent className="relative min-w-0 max-w-full p-2.5 sm:p-6">
                <div className="adray-dashboard-shell relative min-w-0 max-w-full overflow-x-hidden">
                  <div className="adray-hero-bg relative min-w-0 max-w-full overflow-hidden rounded-[30px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.94)_0%,rgba(10,10,14,0.98)_100%)] p-3.5 sm:rounded-[36px] sm:p-8">
                    <div className="adray-hero-grid" />
                    <div className="adray-hero-beam" />

                    <span className="adray-particle left-[12%] top-[16%]" style={{ animationDelay: "0s" }} />
                    <span className="adray-particle left-[18%] top-[70%]" style={{ animationDelay: ".8s" }} />
                    <span className="adray-particle left-[62%] top-[22%]" style={{ animationDelay: "1.4s" }} />
                    <span className="adray-particle left-[74%] top-[62%]" style={{ animationDelay: "2s" }} />
                    <span className="adray-particle left-[48%] top-[78%]" style={{ animationDelay: "2.8s" }} />

                    <div className="relative z-10">
                      <div className="mb-4">
                        <StepProgress step={1} />
                      </div>

                      <div className="min-w-0 max-w-[860px]">
                        <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#B55CFF]/20 bg-[#B55CFF]/10 px-3 py-1 text-[11px] text-[#E7D3FF] backdrop-blur-md">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            {loadingConnections
                              ? "Checking your connected sources"
                              : allReady
                                ? "Your data sources are fully synchronized"
                                : "Activate your data sources to unlock AI-ready insights"}
                          </span>
                        </div>

                        <div className="mt-5 flex items-start gap-4">
                          <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#B55CFF]/20 bg-[#B55CFF]/10 shadow-[0_0_24px_rgba(181,92,255,0.12)] sm:inline-flex">
                            <Sparkles className="h-5 w-5 text-[#D2A7FF]" />
                          </div>

                          <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-[0.24em] text-white/38">
                              Step 1 · Activation
                            </p>

                            <h1 className="mt-3 max-w-[760px] text-[1.82rem] font-extrabold leading-[0.96] tracking-[-0.045em] text-white/95 sm:text-[3.65rem]">
                              {heroTitle}
                            </h1>

                            <p className="mt-4 max-w-3xl text-[13px] leading-6 text-white/56 sm:text-[16px] sm:leading-7">
                              {heroDesc}
                            </p>

                            <div className="mt-5 text-sm text-white/42">
                              {loadingConnections ? "Loading…" : `${completedCount} of ${totalCount} connected`}
                            </div>
                          </div>
                        </div>

                        {asmUiError ? (
                          <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                            {asmUiError}
                          </div>
                        ) : null}

                        <div className="adray-progress-shell mt-5 min-w-0 max-w-full rounded-[24px] border border-white/[0.08] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:mt-7 sm:rounded-[26px] sm:p-5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white/92">Progress</p>
                              <p className="mt-1 text-xs text-white/45">
                                {loadingConnections
                                  ? "Loading your setup status..."
                                  : `${pct}% connected • ${completedCount}/${totalCount}`}
                              </p>
                            </div>

                            <div className="shrink-0 text-right text-xs text-white/55">
                              {loadingConnections ? "Syncing..." : `${pct}%`}
                            </div>
                          </div>

                          <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-[#B55CFF] via-[#C87CFF] to-[#4FE3C1] shadow-[0_0_24px_rgba(181,92,255,0.22)] transition-all duration-500"
                              style={{ width: `${loadingConnections ? 10 : pct}%` }}
                            />
                          </div>

                          <div className="mt-4 -mx-1 sm:mx-0">
                            <div className="no-scrollbar flex gap-2 overflow-x-auto px-1 sm:flex-wrap sm:px-0">
                              <Pill label="Meta Ads" done={metaReady} />
                              <Pill label="Google Ads" done={adsReady} />
                              <Pill label="Google Analytics" done={gaReady} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 overflow-hidden rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.72)_0%,rgba(10,10,14,0.88)_100%)] p-4 backdrop-blur-md sm:mt-6 sm:rounded-[28px] sm:p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="inline-flex items-center gap-2 rounded-full border border-[#B55CFF]/18 bg-[#B55CFF]/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-[#E6D2FF]">
                          <Search className="h-3.5 w-3.5" />
                          Guided Pixel Setup
                        </div>

                        <h2 className="mt-3 text-[1.1rem] font-semibold tracking-[-0.03em] text-white sm:text-[1.28rem]">
                          {pixelConnected ? "Pixel connected" : "Connect your website pixel"}
                        </h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/56">
                          {pixelConnected && pixelShop
                            ? `Tracking active on ${pixelShop}. Run the wizard again to update your setup.`
                            : "Detect your store type and get a guided install flow for the Adray pixel without leaving this page."}
                        </p>
                      </div>

                      {pixelConnected ? (
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 rounded-2xl border border-[#4FE3C1]/30 bg-[#4FE3C1]/10 px-4 py-2.5 text-sm font-semibold text-[#4FE3C1]">
                            <CheckCircle2 className="h-4 w-4" />
                            Connected
                          </div>
                          <Button
                            onClick={() => setPixelWizardOpen(true)}
                            variant="outline"
                            className="h-10 rounded-2xl border-white/10 bg-white/[0.04] px-4 text-sm text-white/70 hover:bg-white/[0.08] hover:text-white md:w-auto"
                          >
                            Reconfigure
                          </Button>
                        </div>
                      ) : (
                        <Button
                          onClick={() => setPixelWizardOpen(true)}
                          className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.22)] transition-all hover:bg-[#A664FF] md:w-auto"
                        >
                          <span>Connect Pixel</span>
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>


                  {asmUiLoading ? (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/60">
                      Opening selector...
                    </div>
                  ) : null}

                  <div className="mt-5 grid grid-cols-1 gap-4 sm:mt-6">
                    {steps.map((s: any, i) => (
                      <StepRow
                        key={s.key}
                        index={i + 1}
                        icon={s.icon}
                        title={s.title}
                        desc={s.desc}
                        state={s.state}
                        todoLabel={s.todoLabel}
                        ctaLabel={s.ctaLabel}
                        onCta={s.onCta}
                        ctaDisabled={loadingConnections || !!s.ctaDisabled}
                        accent={
                          s.key === "meta"
                            ? "emerald"
                            : s.key === "google_ads"
                              ? "purple"
                              : "blue"
                        }
                      />
                    ))}
                  </div>

                  {anyReady ? (
                    <div
                      ref={readyCtaRef}
                      className="relative mt-6 overflow-hidden rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.74)_0%,rgba(11,11,16,0.92)_100%)] p-4 backdrop-blur-md sm:rounded-[30px] sm:p-6"
                    >
                      <div className="pointer-events-none absolute inset-0 opacity-60">
                        <div className="absolute -top-20 right-0 h-56 w-56 rounded-full bg-[#B55CFF]/12 blur-3xl" />
                        <div className="absolute -bottom-20 left-0 h-48 w-48 rounded-full bg-[#4FE3C1]/8 blur-3xl" />
                        <div className="absolute inset-0 translate-x-[-120%] bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.05),transparent)] animate-[adray-shimmer_3.4s_ease-in-out_infinite]" />
                      </div>

                      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#B55CFF]/20 bg-[#B55CFF]/10 shadow-[0_0_20px_rgba(181,92,255,0.12)]">
                              <Sparkle className="h-4 w-4 text-[#D2A7FF]" />
                              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[#0F1012] bg-[#4FE3C1]" />
                            </span>

                            <div className="min-w-0">
                              <p className="text-base font-semibold text-white/94">Your data is ready</p>
                              <p className="mt-1 max-w-2xl text-sm leading-6 text-white/58">{readyDesc}</p>
                            </div>
                          </div>
                        </div>

                        <Button
                          onClick={() => nav("/laststep")}
                          className="h-12 w-full rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.24)] transition-all hover:bg-[#A664FF] md:w-auto animate-[adray-ready-lift_1.5s_ease-in-out_infinite]"
                        >
                          <span className="mr-2">Use in AI</span>
                          <Settings2 className="mr-1 h-4 w-4 opacity-90" />
                          <ArrowRight className="ml-1 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
    <PixelSetupWizard
      open={pixelWizardOpen}
      onOpenChange={setPixelWizardOpen}
      currentShop={pixelConnected && pixelShop ? pixelShop : undefined}
      onDisconnect={() => {
        try { localStorage.removeItem("adray_analytics_shop"); } catch {}
        setPixelWizardOpen(false);
        refreshConnections();
      }}
    />
    <GoogleMerchantSelectorDialog
      open={merchantSelectorOpen}
      onOpenChange={setMerchantSelectorOpen}
      onSaved={() => { void refreshConnections(); }}
    />
  </>
  );
}