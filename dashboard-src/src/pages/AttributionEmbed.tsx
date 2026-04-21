import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { DashboardLayout } from "@/components/DashboardLayout";

const SHOP_STORAGE_KEY = "adray_analytics_shop";

type AnalyticsShopChangedMessage = {
  type?: string;
  shop?: string | null;
};

type OnboardingStatusResponse = {
  ok?: boolean;
  status?: {
    pixel?: { connected?: boolean; shop?: string | null };
  };
};

type PixelStatus = {
  connected: boolean;
  shop: string;
};

function normalizeShop(value?: string | null) {
  return String(value || "").trim();
}

function persistShop(shop: string) {
  try {
    if (shop) window.localStorage.setItem(SHOP_STORAGE_KEY, shop);
    else window.localStorage.removeItem(SHOP_STORAGE_KEY);
  } catch {
    // storage may be unavailable (private mode, disabled); safe to ignore
  }
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
  const [iframeLoaded, setIframeLoaded] = useState(false);
  // null = resolving, otherwise a decided pixel status.
  const [pixelStatus, setPixelStatus] = useState<PixelStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolvePixel() {
      let connected = false;
      let shop = "";
      try {
        const r = await fetch("/api/onboarding/status", { credentials: "include" });
        const data = (await r.json().catch(() => ({}))) as OnboardingStatusResponse;
        const pixel = data?.status?.pixel;
        connected = !!pixel?.connected;
        shop = normalizeShop(pixel?.shop);
      } catch {
        // network error: fall through with connected=false → redirect to wizard
      }

      if (cancelled) return;

      // Keep localStorage in sync with server truth so other surfaces
      // (e.g. the analytics iframe) never read a stale shop.
      persistShop(connected && shop ? shop : "");

      setPixelStatus({ connected: connected && !!shop, shop });

      if (connected && shop) {
        const currentShopInUrl = normalizeShop(
          searchParams.get("shop") || searchParams.get("shopId") || searchParams.get("store")
        );
        if (currentShopInUrl !== shop) {
          setSearchParams(buildShopParams(searchParams, shop), { replace: true });
        }
      }
    }

    resolvePixel();
    return () => { cancelled = true; };
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    function handleMessage(event: MessageEvent<AnalyticsShopChangedMessage>) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== "adray:analytics:shop-changed") return;
      const nextShop = normalizeShop(event.data.shop);
      persistShop(nextShop);
      setSearchParams(buildShopParams(searchParams, nextShop), { replace: true });
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [searchParams, setSearchParams]);

  const iframeSrc = useMemo(() => {
    if (!pixelStatus?.connected || !pixelStatus.shop) return "";
    const params = new URLSearchParams();
    params.set("embedded", "1");
    params.set("shop", pixelStatus.shop);
    return `/adray-analytics.html?${params.toString()}`;
  }, [pixelStatus]);

  useEffect(() => {
    setIframeLoaded(false);
  }, [iframeSrc]);

  // Still resolving pixel connection.
  if (pixelStatus === null) {
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

  // No pixel installed yet — send the user to the setup wizard instead of
  // rendering analytics for some unrelated shop.
  if (!pixelStatus.connected) {
    return <Navigate to="/?openPixelWizard=1" replace />;
  }

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
                Preparing analytics for {pixelStatus.shop}. You will see the embedded dashboard as soon as the first data payload arrives.
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
