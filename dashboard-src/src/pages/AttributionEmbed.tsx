import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { DashboardLayout } from "@/components/DashboardLayout";
import { PixelSetupWizard } from "@/components/PixelSetupWizard";
import { Button } from "@/components/ui/button";
import { BarChart3, ArrowRight } from "lucide-react";

const SHOP_STORAGE_KEY = "adray_analytics_shop";

type AnalyticsShopChangedMessage = {
  type?: string;
  shop?: string | null;
};

type SessionResponse = {
  authenticated?: boolean;
  user?: {
    shop?: string | null;
    resolvedShop?: string | null;
  };
};

type AuthorizedShopsResponse = {
  defaultShop?: string | null;
  shops?: Array<{
    shop?: string | null;
    isDefault?: boolean;
  }>;
};

function normalizeShop(value?: string | null) {
  return String(value || "").trim();
}

function readStoredShop() {
  try {
    return normalizeShop(window.localStorage.getItem(SHOP_STORAGE_KEY));
  } catch {
    return "";
  }
}

function persistShop(shop: string) {
  try {
    window.localStorage.setItem(SHOP_STORAGE_KEY, shop);
  } catch { }
}

function clearStoredShop() {
  try {
    window.localStorage.removeItem(SHOP_STORAGE_KEY);
  } catch { }
}

function buildShopParams(searchParams: URLSearchParams, shop: string) {
  const nextParams = new URLSearchParams(searchParams);
  if (shop) nextParams.set("shop", shop);
  else nextParams.delete("shop");
  nextParams.delete("shopId");
  nextParams.delete("store");
  return nextParams;
}

export default function AttributionEmbed() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [storedShop, setStoredShop] = useState(() => readStoredShop());
  const [sessionShop, setSessionShop] = useState("");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  // null = resolving, "" = no shop/not connected, "domain" = pixel setup completed
  const [resolvedShop, setResolvedShop] = useState<string | null>(null);
  const [pixelConnected, setPixelConnected] = useState<boolean | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const shopFromUrl = useMemo(
    () => normalizeShop(searchParams.get("shop") || searchParams.get("shopId") || searchParams.get("store")),
    [searchParams]
  );

  useEffect(() => {
    if (!shopFromUrl) return;
    setStoredShop(shopFromUrl);
    persistShop(shopFromUrl);
  }, [shopFromUrl]);

  useEffect(() => {
    let cancelled = false;

    async function loadSessionShop() {
      // ── Step 1: gate — check if pixel setup was completed ──
      let connected = false;
      let pixelShop = "";
      try {
        const r = await fetch("/api/onboarding/status", { credentials: "include" });
        const data = await r.json().catch(() => ({}));
        connected = !!data?.pixel?.connected;
        pixelShop = normalizeShop(data?.pixel?.shop);
      } catch { }

      if (cancelled) return;

      if (!connected) {
        // Clear any stale localStorage shop so it doesn't leak into future sessions
        clearStoredShop();
        setPixelConnected(false);
        setResolvedShop("");
        return;
      }

      setPixelConnected(true);

      // ── Step 2: resolve which shop to show ──
      let nextShop = pixelShop;

      if (!nextShop) {
        try {
          const response = await fetch("/api/session", { credentials: "include" });
          const data = (await response.json().catch(() => ({}))) as SessionResponse;
          if (cancelled) return;
          nextShop = normalizeShop(data?.user?.shop || data?.user?.resolvedShop);
        } catch { }
      }

      if (!nextShop) {
        try {
          const response = await fetch("/api/analytics/shops", { credentials: "include" });
          const data = (await response.json().catch(() => ({}))) as AuthorizedShopsResponse;
          if (cancelled) return;
          nextShop = normalizeShop(
            data?.defaultShop || data?.shops?.find((item) => item?.isDefault)?.shop || data?.shops?.[0]?.shop
          );
        } catch { }
      }

      if (cancelled) return;

      if (nextShop) {
        setSessionShop(nextShop);
        if (!shopFromUrl && !readStoredShop()) {
          setStoredShop(nextShop);
          persistShop(nextShop);
          setSearchParams(buildShopParams(searchParams, nextShop), { replace: true });
        }
      }

      const final = shopFromUrl || readStoredShop() || nextShop;
      setResolvedShop(final);
    }

    loadSessionShop();
    return () => { cancelled = true; };
  }, [searchParams, setSearchParams, shopFromUrl, refreshKey]);

  useEffect(() => {
    function handleMessage(event: MessageEvent<AnalyticsShopChangedMessage>) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== "adray:analytics:shop-changed") return;
      const nextShop = normalizeShop(event.data.shop);
      setStoredShop(nextShop);
      if (nextShop) persistShop(nextShop);
      setSearchParams(buildShopParams(searchParams, nextShop), { replace: true });
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [searchParams, setSearchParams]);

  const activeShop = shopFromUrl || storedShop || sessionShop;

  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams();
    params.set("embedded", "1");
    if (activeShop) params.set("shop", activeShop);
    return `/adray-analytics.html?${params.toString()}`;
  }, [activeShop]);

  useEffect(() => {
    setIframeLoaded(false);
  }, [iframeSrc]);

  // Still resolving
  if (resolvedShop === null || pixelConnected === null) {
    return (
      <DashboardLayout>
        <div className="flex h-screen items-center justify-center bg-[#050508]">
          <div className="h-2 w-48 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-2 w-1/2 animate-[loaderSlide_1.3s_ease-in-out_infinite] rounded-full bg-[linear-gradient(90deg,#B55CFF_0%,#7EF0C8_100%)]" />
          </div>
          <style>{`@keyframes loaderSlide{0%{transform:translateX(-100%)}55%{transform:translateX(110%)}100%{transform:translateX(110%)}}`}</style>
        </div>
      </DashboardLayout>
    );
  }

  // Pixel not set up — gate
  if (pixelConnected === false) {
    return (
      <DashboardLayout>
        <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(181,92,255,0.14),_transparent_52%),linear-gradient(180deg,#09070d_0%,#050508_100%)] p-6">
          <div className="w-full max-w-lg rounded-[28px] border border-[rgba(181,92,255,0.2)] bg-[rgba(17,13,24,0.9)] px-6 py-8 text-[#F3E8FF] shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#B55CFF]/25 bg-[#B55CFF]/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-[#E5CFFF]">
              <BarChart3 className="h-3.5 w-3.5" />
              Attribution
            </div>

            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">
              Connect your store first
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#BFAFD6]">
              The Attribution Dashboard requires a connected pixel. Complete the Pixel Setup Wizard to link your store and start seeing attribution data.
            </p>

            <Button
              className="mt-6 h-11 w-full rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.18)] hover:bg-[#A864FF]"
              onClick={() => setWizardOpen(true)}
            >
              Set up pixel
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          <PixelSetupWizard
            open={wizardOpen}
            onOpenChange={(open) => {
              setWizardOpen(open);
              if (!open) {
                setPixelConnected(null);
                setResolvedShop(null);
                setRefreshKey((k) => k + 1);
              }
            }}
            onDisconnect={() => {
              clearStoredShop();
              setStoredShop("");
              setSessionShop("");
              setPixelConnected(false);
              setResolvedShop("");
              setWizardOpen(false);
            }}
          />
        </div>
        <style>{`@keyframes loaderSlide{0%{transform:translateX(-100%)}55%{transform:translateX(110%)}100%{transform:translateX(110%)}}`}</style>
      </DashboardLayout>
    );
  }

  // Has shop — show dashboard
  return (
    <DashboardLayout>
      <div className="relative h-[calc(100vh-6rem)] overflow-hidden bg-[#050508] md:h-screen">
        {!iframeLoaded ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(181,92,255,0.16),_transparent_52%),linear-gradient(180deg,#09070d_0%,#050508_100%)]">
            <div className="w-full max-w-xl rounded-[28px] border border-[rgba(181,92,255,0.2)] bg-[rgba(17,13,24,0.9)] px-6 py-7 text-[#F3E8FF] shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 animate-pulse rounded-full bg-[#7EF0C8]" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#BCA6D7]">
                  Attribution
                </p>
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white">
                Loading attribution dashboard
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#BFAFD6]">
                Preparing analytics for {activeShop}. You will see the embedded dashboard as soon as the first data payload arrives.
              </p>
              <div className="mt-5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]">
                <div className="h-2 w-1/2 animate-[loaderSlide_1.3s_ease-in-out_infinite] rounded-full bg-[linear-gradient(90deg,#B55CFF_0%,#7EF0C8_100%)]" />
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {["Resolving store", "Loading charts", "Warming live feed"].map((label) => (
                  <div key={label} className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                    <div className="h-2 w-16 animate-pulse rounded-full bg-[rgba(181,92,255,0.42)]" />
                    <p className="mt-3 text-xs font-medium text-[#D8C7EE]">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        <iframe
          src={iframeSrc}
          title="AdRay Attribution Dashboard"
          loading="eager"
          onLoad={() => setIframeLoaded(true)}
          className="block h-full w-full border-0 bg-[#050508]"
        />
        <style>{`
          @keyframes loaderSlide {
            0% { transform: translateX(-100%); }
            55% { transform: translateX(110%); }
            100% { transform: translateX(110%); }
          }
        `}</style>
      </div>
    </DashboardLayout>
  );
}
