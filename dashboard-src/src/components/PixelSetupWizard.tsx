import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Search,
  Store,
  Unlink,
  RefreshCw,
  ShieldCheck,
  ShieldX,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type StoreType = "woocommerce" | "shopify" | "magento" | "custom";
type DetectionConfidence = "high" | "medium" | "low";
type WizardStep = "manage" | "domain" | "confirm" | "instructions";

type StoreDetectionResult = {
  normalizedUrl: string;
  hostname: string;
  detectedType: StoreType;
  confidence: DetectionConfidence;
  signals: string[];
  suggestedPluginsUrl?: string;
};

type DetectStoreResponse = {
  ok: boolean;
  data: StoreDetectionResult;
};

export type PixelSetupWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentShop?: string;
  onDisconnect?: () => void;
};

const STORE_TYPE_OPTIONS: Array<{ value: StoreType; label: string; blurb: string }> = [
  {
    value: "woocommerce",
    label: "WooCommerce",
    blurb: "Guided install is ready now with a downloadable WordPress plugin ZIP.",
  },
  {
    value: "shopify",
    label: "Shopify",
    blurb: "Detection works now. Guided install steps are coming soon.",
  },
  {
    value: "magento",
    label: "Magento",
    blurb: "Detection works now. Guided install steps are coming soon.",
  },
  {
    value: "custom",
    label: "Custom",
    blurb: "Use this when your storefront is custom-built or not recognized.",
  },
];

const FLOW_STEPS: Array<{ key: WizardStep; label: string }> = [
  { key: "domain", label: "Enter domain" },
  { key: "confirm", label: "Confirm store type" },
  { key: "instructions", label: "Install pixel" },
];

const CONFIDENCE_LABELS: Record<DetectionConfidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  let payload: any = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || text || `Request failed with HTTP ${response.status}`);
  }
  return (payload || {}) as T;
}

function titleCaseStoreType(type: StoreType) {
  return STORE_TYPE_OPTIONS.find((o) => o.value === type)?.label || "Custom";
}

const SHOP_STORAGE_KEY = "adray_analytics_shop";

function persistShop(shop: string) {
  try { window.localStorage.setItem(SHOP_STORAGE_KEY, shop); } catch { }
}

function clearStoredShop() {
  try { window.localStorage.removeItem(SHOP_STORAGE_KEY); } catch { }
}

function initialStep(currentShop?: string): WizardStep {
  return currentShop ? "manage" : "domain";
}

type VerifyResult = { detected: boolean; logs?: string[]; checkedUrl?: string };

function VerifyResultPanel({ result }: { result: VerifyResult }) {
  const [logsOpen, setLogsOpen] = useState(false);
  return (
    <div className={cn(
      "w-full rounded-2xl border p-3 text-sm",
      result.detected
        ? "border-[#4FE3C1]/25 bg-[#4FE3C1]/[0.06]"
        : "border-yellow-400/25 bg-yellow-400/[0.06]"
    )}>
      <div className="flex items-center gap-2">
        {result.detected
          ? <ShieldCheck className="h-4 w-4 shrink-0 text-[#4FE3C1]" />
          : <ShieldX className="h-4 w-4 shrink-0 text-yellow-400" />}
        <span className={result.detected ? "text-[#E8FFF8]" : "text-yellow-100"}>
          {result.detected
            ? "Pixel detected on your site — you're all set!"
            : "Pixel not detected yet. Make sure you activated the plugin, then try again."}
        </span>
        {result.logs?.length ? (
          <button
            type="button"
            onClick={() => setLogsOpen(o => !o)}
            className="ml-auto shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/50 hover:text-white/80"
          >
            {logsOpen ? "Hide logs" : "View logs"}
          </button>
        ) : null}
      </div>
      {logsOpen && result.logs?.length ? (
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/30 p-3 font-mono text-[11px] leading-5 text-white/60">
          {result.checkedUrl && (
            <div className="mb-2 text-white/40">Checked: {result.checkedUrl}</div>
          )}
          {result.logs.map((line, i) => (
            <div key={i} className={cn(
              line.startsWith("✅") ? "text-[#4FE3C1]" :
              line.startsWith("❌") ? "text-white/38" :
              line.startsWith("🟢") ? "text-[#4FE3C1] font-semibold" :
              line.startsWith("🟡") ? "text-yellow-300" :
              line.startsWith("⚠️") ? "text-red-300" :
              "text-white/55"
            )}>
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PixelSetupWizard({ open, onOpenChange, currentShop, onDisconnect }: PixelSetupWizardProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>(() => initialStep(currentShop));
  const [domainInput, setDomainInput] = useState("");
  const [isDetecting, setIsDetecting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState("");
  const [detection, setDetection] = useState<StoreDetectionResult | null>(null);
  const [selectedType, setSelectedType] = useState<StoreType>("woocommerce");
  const [confirmedShop, setConfirmedShop] = useState("");

  useEffect(() => {
    if (!open) {
      setStep(initialStep(currentShop));
      setDomainInput("");
      setIsDetecting(false);
      setIsConfirming(false);
      setIsDisconnecting(false);
      setIsVerifying(false);
      setVerifyResult(null);
      setError("");
      setDetection(null);
      setSelectedType("woocommerce");
      setConfirmedShop("");
    }
  }, [open, currentShop]);

  useEffect(() => {
    if (open) setStep(initialStep(currentShop));
  }, [currentShop, open]);

  const flowStepIndex = FLOW_STEPS.findIndex((s) => s.key === step);

  const selectedTypeOption = useMemo(
    () => STORE_TYPE_OPTIONS.find((o) => o.value === selectedType),
    [selectedType]
  );

  const suggestedPluginsUrl = useMemo(() => {
    if (detection?.suggestedPluginsUrl) return detection.suggestedPluginsUrl;
    if (!detection?.normalizedUrl) return "";
    try {
      return new URL("/wp-admin/plugins.php", detection.normalizedUrl).toString();
    } catch {
      return "";
    }
  }, [detection]);

  async function handleDetectStore(event?: FormEvent) {
    event?.preventDefault();
    if (!domainInput.trim()) {
      setError("Enter your storefront domain to continue.");
      return;
    }
    setIsDetecting(true);
    setError("");
    try {
      const result = await postJson<DetectStoreResponse>("/api/pixel-setup/detect-store", { domain: domainInput });
      setDetection(result.data);
      setSelectedType(result.data.detectedType);
      setStep("confirm");
    } catch (e: any) {
      setError(e?.message || "We could not detect the store type right now.");
    } finally {
      setIsDetecting(false);
    }
  }

  async function handleConfirmShop() {
    if (!detection) return;
    setIsConfirming(true);
    setError("");
    try {
      const result = await postJson<{ ok: boolean; shop?: string }>(
        "/api/pixel-setup/confirm-shop",
        { hostname: detection.hostname, normalizedUrl: detection.normalizedUrl, storeType: selectedType }
      );
      if (result.ok && result.shop) {
        persistShop(result.shop);
        setConfirmedShop(result.shop);
      }
    } catch {
      // non-blocking
    } finally {
      setIsConfirming(false);
      setStep("instructions");
    }
  }

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      await postJson("/api/pixel-setup/disconnect", {});
      clearStoredShop();
      onDisconnect?.();
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || "Could not disconnect the store. Try again.");
    } finally {
      setIsDisconnecting(false);
    }
  }

  async function handleVerifyPixel() {
    const shop = confirmedShop || currentShop;
    if (!shop) return;
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const r = await fetch(`/api/pixel-setup/verify?shop=${encodeURIComponent(shop)}`, { credentials: "include" });
      const data = await r.json().catch(() => ({}));
      setVerifyResult({ detected: !!data.detected, logs: data.logs, checkedUrl: data.checkedUrl });
    } catch {
      setVerifyResult({ detected: false });
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[960px] overflow-hidden rounded-[30px] border border-white/[0.08] bg-[#09080F] p-0 text-white shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
        <div className="max-h-[92vh] overflow-y-auto">
          {/* Header */}
          <div className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(181,92,255,0.14),transparent_48%),linear-gradient(180deg,rgba(20,14,34,0.96)_0%,rgba(10,10,16,0.98)_100%)] px-6 py-6 sm:px-8">
            <DialogHeader className="space-y-3 text-left">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#B55CFF]/25 bg-[#B55CFF]/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-[#E5CFFF]">
                <Store className="h-3.5 w-3.5" />
                Pixel Setup Wizard
              </div>

              <DialogTitle className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-[2rem]">
                {step === "manage" ? "Manage pixel connection" : "Connect your website pixel"}
              </DialogTitle>

              <DialogDescription className="max-w-2xl text-sm leading-6 text-white/62 sm:text-[15px]">
                {step === "manage"
                  ? "Your pixel is connected. You can disconnect the current store or connect a new one."
                  : "Detect the store platform behind your website, confirm it, and follow the right install flow for the Adray pixel."}
              </DialogDescription>
            </DialogHeader>

            {/* Step indicators — only show for install flow */}
            {step !== "manage" && (
              <div className="mt-5 flex flex-wrap gap-2">
                {FLOW_STEPS.map((item, index) => {
                  const active = flowStepIndex === index;
                  const complete = flowStepIndex > index;
                  return (
                    <div
                      key={item.key}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-all",
                        active
                          ? "border-[#B55CFF]/35 bg-[#B55CFF]/16 text-white shadow-[0_0_18px_rgba(181,92,255,0.12)]"
                          : complete
                            ? "border-[#4FE3C1]/25 bg-[#4FE3C1]/10 text-[#E8FFF8]"
                            : "border-white/10 bg-white/[0.03] text-white/55"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold",
                          active
                            ? "border-[#D2A7FF]/50 bg-[#B55CFF]/15 text-[#F3E8FF]"
                            : complete
                              ? "border-[#4FE3C1]/40 bg-[#4FE3C1]/12 text-[#DFFBF3]"
                              : "border-white/12 bg-white/[0.03] text-white/50"
                        )}
                      >
                        {complete ? <CheckCircle2 className="h-3 w-3" /> : index + 1}
                      </span>
                      <span>{item.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-6 px-6 py-6 sm:px-8 sm:py-7">

            {/* ── MANAGE step ── */}
            {step === "manage" && currentShop && (
              <div className="space-y-6">
                {/* Current connection card */}
                <div className="rounded-[26px] border border-[#4FE3C1]/20 bg-[#4FE3C1]/[0.04] p-5">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#4FE3C1]/25 bg-[#4FE3C1]/12 text-[#4FE3C1]">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[#4FE3C1]/70">Currently connected</p>
                      <p className="mt-1 text-lg font-semibold text-white">{currentShop}</p>
                    </div>
                  </div>

                  {/* Pixel verification */}
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isVerifying}
                      onClick={handleVerifyPixel}
                      className="h-9 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white/70 hover:bg-white/[0.06] hover:text-white"
                    >
                      {isVerifying ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying…</>
                      ) : (
                        <><RefreshCw className="h-3.5 w-3.5" /> Verify pixel</>
                      )}
                    </Button>

                    {verifyResult !== null && (
                      <VerifyResultPanel result={verifyResult} />
                    )}
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="button"
                    disabled={isDisconnecting}
                    onClick={handleDisconnect}
                    className="h-11 rounded-2xl border border-red-400/25 bg-red-400/10 px-5 text-red-200 hover:bg-red-400/20 hover:text-red-100"
                    variant="ghost"
                  >
                    {isDisconnecting
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Disconnecting…</>
                      : <><Unlink className="h-4 w-4" /> Disconnect store</>
                    }
                  </Button>

                  <Button
                    type="button"
                    className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.18)] hover:bg-[#A864FF]"
                    onClick={() => { setStep("domain"); setError(""); }}
                  >
                    Connect a different store
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* ── DOMAIN step ── */}
            {step === "domain" && (
              <form className="space-y-6" onSubmit={handleDetectStore}>
                <div className="rounded-[26px] border border-white/[0.08] bg-white/[0.02] p-5">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#B55CFF]/20 bg-[#B55CFF]/10 text-[#DFC4FF]">
                      <Search className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold text-white">Enter your storefront domain</h3>
                      <p className="mt-1 text-sm leading-6 text-white/58">
                        Paste a raw domain like <span className="text-white/78">shogun.mx</span> or a full URL like{" "}
                        <span className="text-white/78">https://shogun.mx</span>. We will detect the storefront type from the homepage.
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    <Input
                      value={domainInput}
                      onChange={(e) => setDomainInput(e.target.value)}
                      placeholder="Enter your domain"
                      autoFocus
                      className="h-12 rounded-2xl border-white/10 bg-[#0F0D18] px-4 text-white placeholder:text-white/28 focus-visible:ring-[#B55CFF]/55"
                    />
                    <p className="text-xs text-white/42">
                      We only inspect the storefront homepage to suggest the platform. You will still confirm the result before continuing.
                    </p>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 rounded-2xl border border-white/10 bg-white/[0.03] px-5 text-white/70 hover:bg-white/[0.06] hover:text-white"
                    onClick={() => currentShop ? setStep("manage") : onOpenChange(false)}
                  >
                    {currentShop ? "Back" : "Cancel"}
                  </Button>

                  <Button
                    type="submit"
                    disabled={isDetecting}
                    className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.18)] hover:bg-[#A864FF]"
                  >
                    {isDetecting
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Detecting store type</>
                      : <>Detect store type <ArrowRight className="h-4 w-4" /></>
                    }
                  </Button>
                </div>
              </form>
            )}

            {/* ── CONFIRM step ── */}
            {step === "confirm" && detection && (
              <div className="space-y-6">
                <div className="rounded-[26px] border border-white/[0.08] bg-white/[0.02] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="rounded-full border border-[#B55CFF]/20 bg-[#B55CFF]/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#E6D2FF]">
                          Detected
                        </Badge>
                        <Badge className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/70">
                          {CONFIDENCE_LABELS[detection.confidence]}
                        </Badge>
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-white">
                          We think this store is {titleCaseStoreType(detection.detectedType)}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-white/58">
                          Review the result below and confirm or correct it before continuing.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-[#100D18] px-4 py-3 text-sm text-white/76">
                        {detection.normalizedUrl}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-[#0F0D18] px-4 py-3 text-sm text-white/70">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-white/38">Matched signals</div>
                      <ul className="mt-3 space-y-2">
                        {detection.signals.map((signal) => (
                          <li key={signal} className="flex items-start gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#4FE3C1]" />
                            <span>{signal}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {STORE_TYPE_OPTIONS.map((option) => {
                    const selected = option.value === selectedType;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setSelectedType(option.value)}
                        className={cn(
                          "rounded-[24px] border p-4 text-left transition-all",
                          selected
                            ? "border-[#B55CFF]/35 bg-[#B55CFF]/12 shadow-[0_0_18px_rgba(181,92,255,0.1)]"
                            : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-base font-semibold text-white">{option.label}</div>
                            <p className="mt-1 text-sm leading-6 text-white/54">{option.blurb}</p>
                          </div>
                          <span className={cn(
                            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                            selected
                              ? "border-[#C98BFF]/50 bg-[#B55CFF]/18 text-white"
                              : "border-white/14 bg-white/[0.03] text-transparent"
                          )}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 rounded-2xl border border-white/10 bg-white/[0.03] px-5 text-white/70 hover:bg-white/[0.06] hover:text-white"
                    onClick={() => { setStep("domain"); setError(""); }}
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    disabled={isConfirming}
                    className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.18)] hover:bg-[#A864FF]"
                    onClick={handleConfirmShop}
                  >
                    {isConfirming
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Connecting store</>
                      : <>Continue <ArrowRight className="h-4 w-4" /></>
                    }
                  </Button>
                </div>
              </div>
            )}

            {/* ── INSTRUCTIONS step ── */}
            {step === "instructions" && detection && (
              <div className="space-y-6">
                {confirmedShop && (
                  <div className="flex items-center gap-3 rounded-2xl border border-[#4FE3C1]/20 bg-[#4FE3C1]/10 px-4 py-3 text-sm text-[#E8FFF8]">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#4FE3C1]" />
                    <span>
                      <span className="font-semibold">{confirmedShop}</span> connected. The Attribution Dashboard is ready.
                    </span>
                  </div>
                )}

                {/* Pixel verification banner */}
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
                  <div className="flex-1 text-sm text-white/60">
                    After installing the pixel, verify it was detected on your site.
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isVerifying || !confirmedShop}
                    onClick={handleVerifyPixel}
                    className="h-9 shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white/70 hover:bg-white/[0.06] hover:text-white"
                  >
                    {isVerifying
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</>
                      : <><RefreshCw className="h-3.5 w-3.5" /> Verify pixel</>
                    }
                  </Button>

                  {verifyResult !== null && (
                    <VerifyResultPanel result={verifyResult} />
                  )}
                </div>

                {selectedType === "woocommerce" ? (
                  <>
                    <div className="rounded-[26px] border border-white/[0.08] bg-white/[0.02] p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="rounded-full border border-[#4FE3C1]/20 bg-[#4FE3C1]/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#E6FFF9]">
                              WooCommerce install
                            </Badge>
                            <Badge className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/70">
                              {detection.hostname}
                            </Badge>
                          </div>
                          <div>
                            <h3 className="text-xl font-semibold text-white">Install the Adray pixel plugin</h3>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">
                              Download the plugin ZIP, upload it in WordPress, then activate it. The ZIP already includes the Adray pixel and is ready to install.
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                          <Button
                            asChild
                            className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.18)] hover:bg-[#A864FF]"
                          >
                            <a href="/wp-plugin/adnova-pixel/download/adnova-pixel.zip">
                              <Download className="h-4 w-4" />
                              Download plugin ZIP
                            </a>
                          </Button>
                          <Button
                            asChild
                            variant="ghost"
                            className="h-11 rounded-2xl border border-white/10 bg-white/[0.03] px-5 text-white/72 hover:bg-white/[0.06] hover:text-white"
                          >
                            <a href={suggestedPluginsUrl || detection.normalizedUrl} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-4 w-4" />
                              Open WordPress plugins
                            </a>
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      {[
                        { title: "Download the plugin ZIP", body: "Use the download button above. This package already includes the Adray pixel and is ready to upload." },
                        { title: "Open your WordPress Plugins screen", body: `Go to ${suggestedPluginsUrl || `${detection.normalizedUrl}wp-admin/plugins.php`} in your site admin.` },
                        { title: "Click Add Plugin, then Upload Plugin", body: "Choose the ZIP you just downloaded from Adray." },
                        { title: "Click Install", body: "Wait a few seconds while WordPress uploads and installs the plugin." },
                        { title: "Activate the plugin", body: "Click Activate and your Adray pixel will be live on the store." },
                      ].map((item, index) => (
                        <div key={item.title} className="rounded-[22px] border border-white/10 bg-[#0F0D18] px-4 py-4">
                          <div className="flex items-start gap-3">
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#B55CFF]/25 bg-[#B55CFF]/12 text-sm font-semibold text-white">
                              {index + 1}
                            </span>
                            <div>
                              <h4 className="text-base font-semibold text-white">{item.title}</h4>
                              <p className="mt-1 text-sm leading-6 text-white/56">{item.body}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="rounded-[26px] border border-white/[0.08] bg-white/[0.02] p-5">
                    <div className="flex items-start gap-3">
                      <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/78">
                        <Store className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/70">
                            {titleCaseStoreType(selectedType)}
                          </Badge>
                          <Badge className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/70">
                            Coming soon
                          </Badge>
                        </div>
                        <h3 className="mt-3 text-xl font-semibold text-white">
                          Guided setup for {titleCaseStoreType(selectedType)} is coming soon
                        </h3>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">
                          We can already detect this storefront type, but the guided install flow is only available for WooCommerce right now.
                        </p>
                        {selectedTypeOption && (
                          <p className="mt-4 text-sm leading-6 text-white/46">{selectedTypeOption.blurb}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 rounded-2xl border border-white/10 bg-white/[0.03] px-5 text-white/70 hover:bg-white/[0.06] hover:text-white"
                    onClick={() => setStep("confirm")}
                  >
                    Back
                  </Button>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    {confirmedShop ? (
                      <Button
                        type="button"
                        className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.18)] hover:bg-[#A864FF]"
                        onClick={() => { onOpenChange(false); navigate("/attribution"); }}
                      >
                        <BarChart3 className="h-4 w-4" />
                        Go to Attribution Dashboard
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.18)] hover:bg-[#A864FF]"
                        onClick={() => onOpenChange(false)}
                      >
                        Done
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
