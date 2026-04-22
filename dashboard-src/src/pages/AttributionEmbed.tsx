import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ParticleField } from "@/components/ParticleField";
import { Card, CardContent } from "@/components/ui/card";

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
        <ParticleField variant="multiverse" count={20} />
        <div className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-8 sm:px-6">
          <Card className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.72)_0%,rgba(10,10,14,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-md">
            <div className="pointer-events-none absolute inset-0 opacity-60">
              <div className="absolute -top-20 right-0 h-48 w-48 rounded-full bg-[#B55CFF]/10 blur-3xl" />
              <div className="absolute -bottom-20 left-0 h-40 w-40 rounded-full bg-[#4FE3C1]/6 blur-3xl" />
            </div>

            <CardContent className="relative p-6 sm:p-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#B55CFF]/30 bg-[#B55CFF]/12 px-3.5 py-1.5 text-xs font-semibold text-[#D8B8FF] shadow-[0_0_18px_rgba(181,92,255,0.14)] backdrop-blur-md">
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B55CFF]/50" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#D8B8FF]" />
                </span>
                ATTRIBUTION
              </div>

              <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-[1.6rem]">
                Checking your workspace
              </h1>
              <p className="mt-2 text-sm leading-6 text-white/58">
                Verifying your pixel connection…
              </p>

              <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full w-1/2 rounded-full bg-[linear-gradient(90deg,#B55CFF_0%,#4FE3C1_100%)] shadow-[0_0_16px_rgba(181,92,255,0.35)] animate-[adray-attribution-loader-slide_1.4s_ease-in-out_infinite]" />
              </div>
            </CardContent>
          </Card>
        </div>
        <style>{`@keyframes adray-attribution-loader-slide{0%{transform:translateX(-100%)}55%{transform:translateX(110%)}100%{transform:translateX(110%)}}`}</style>
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
          <div className="absolute inset-0 z-10 overflow-hidden">
            <ParticleField variant="multiverse" count={28} />
            <div className="relative flex h-full items-center justify-center px-4 py-8 sm:px-6">
              <Card className="relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.72)_0%,rgba(10,10,14,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-md">
                <div className="pointer-events-none absolute inset-0 opacity-60">
                  <div className="absolute -top-24 right-0 h-64 w-64 rounded-full bg-[#B55CFF]/10 blur-3xl" />
                  <div className="absolute -bottom-24 left-0 h-56 w-56 rounded-full bg-[#4FE3C1]/6 blur-3xl" />
                  <div className="absolute inset-0 translate-x-[-120%] bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.04),transparent)] animate-[adray-shimmer_4.2s_ease-in-out_infinite]" />
                </div>

                <CardContent className="relative p-6 sm:p-10">
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#B55CFF]/30 bg-[#B55CFF]/12 px-3.5 py-1.5 text-xs font-semibold text-[#D8B8FF] shadow-[0_0_18px_rgba(181,92,255,0.14)] backdrop-blur-md">
                    <span className="relative inline-flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B55CFF]/50" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#D8B8FF]" />
                    </span>
                    ATTRIBUTION
                  </div>

                  <h1 className="mt-5 text-[1.75rem] font-semibold tracking-[-0.03em] text-white sm:text-[2.2rem]">
                    Loading attribution data
                  </h1>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-white/58 sm:text-[0.95rem] sm:leading-7">
                    Fetching metrics, journeys, and live signals for {pixelStatus.shop}.
                  </p>

                  <div className="mt-7 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full w-1/2 rounded-full bg-[linear-gradient(90deg,#B55CFF_0%,#4FE3C1_100%)] shadow-[0_0_18px_rgba(181,92,255,0.4)] animate-[adray-attribution-loader-slide_1.4s_ease-in-out_infinite]" />
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-3 sm:mt-7 sm:grid-cols-3">
                    {["Resolving store", "Loading charts", "Warming live feed"].map((label) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 backdrop-blur-md transition-all duration-300 hover:border-white/[0.14] hover:bg-white/[0.05]"
                      >
                        <div className="h-2 w-16 animate-pulse rounded-full bg-[#B55CFF]/45" />
                        <p className="mt-3 text-xs font-medium text-white/65">{label}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
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
          @keyframes adray-attribution-loader-slide {
            0% { transform: translateX(-100%); }
            55% { transform: translateX(110%); }
            100% { transform: translateX(110%); }
          }
        `}</style>
      </div>
    </DashboardLayout>
  );
}
