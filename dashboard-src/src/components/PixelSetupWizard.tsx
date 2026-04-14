import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Search,
  Store,
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
type WizardStep = "domain" | "confirm" | "instructions";

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

type PixelSetupWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

const WIZARD_STEPS: Array<{ key: WizardStep; label: string }> = [
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
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new Error(
      payload?.error ||
        payload?.message ||
        text ||
        `Request failed with HTTP ${response.status}`
    );
  }

  return (payload || {}) as T;
}

function titleCaseStoreType(type: StoreType) {
  return STORE_TYPE_OPTIONS.find((option) => option.value === type)?.label || "Custom";
}

function resetWizardState() {
  return {
    step: "domain" as WizardStep,
    domainInput: "",
    isDetecting: false,
    error: "",
    detection: null as StoreDetectionResult | null,
    selectedType: "woocommerce" as StoreType,
  };
}

export function PixelSetupWizard({ open, onOpenChange }: PixelSetupWizardProps) {
  const [step, setStep] = useState<WizardStep>("domain");
  const [domainInput, setDomainInput] = useState("");
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState("");
  const [detection, setDetection] = useState<StoreDetectionResult | null>(null);
  const [selectedType, setSelectedType] = useState<StoreType>("woocommerce");

  useEffect(() => {
    if (!open) {
      const next = resetWizardState();
      setStep(next.step);
      setDomainInput(next.domainInput);
      setIsDetecting(next.isDetecting);
      setError(next.error);
      setDetection(next.detection);
      setSelectedType(next.selectedType);
    }
  }, [open]);

  const currentStepIndex = WIZARD_STEPS.findIndex((item) => item.key === step);

  const selectedTypeOption = useMemo(
    () => STORE_TYPE_OPTIONS.find((option) => option.value === selectedType),
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
      const result = await postJson<DetectStoreResponse>("/api/pixel-setup/detect-store", {
        domain: domainInput,
      });

      setDetection(result.data);
      setSelectedType(result.data.detectedType);
      setStep("confirm");
    } catch (detectError: any) {
      setError(detectError?.message || "We could not detect the store type right now.");
    } finally {
      setIsDetecting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[960px] overflow-hidden rounded-[30px] border border-white/[0.08] bg-[#09080F] p-0 text-white shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
        <div className="max-h-[92vh] overflow-y-auto">
          <div className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(181,92,255,0.14),transparent_48%),linear-gradient(180deg,rgba(20,14,34,0.96)_0%,rgba(10,10,16,0.98)_100%)] px-6 py-6 sm:px-8">
            <DialogHeader className="space-y-3 text-left">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#B55CFF]/25 bg-[#B55CFF]/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-[#E5CFFF]">
                <Store className="h-3.5 w-3.5" />
                Pixel Setup Wizard
              </div>

              <DialogTitle className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-[2rem]">
                Connect your website pixel
              </DialogTitle>

              <DialogDescription className="max-w-2xl text-sm leading-6 text-white/62 sm:text-[15px]">
                Detect the store platform behind your website, confirm it, and follow the
                right install flow for the Adray pixel.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 flex flex-wrap gap-2">
              {WIZARD_STEPS.map((item, index) => {
                const active = currentStepIndex === index;
                const complete = currentStepIndex > index;

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
          </div>

          <div className="space-y-6 px-6 py-6 sm:px-8 sm:py-7">
            {step === "domain" ? (
              <form className="space-y-6" onSubmit={handleDetectStore}>
                <div className="rounded-[26px] border border-white/[0.08] bg-white/[0.02] p-5">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#B55CFF]/20 bg-[#B55CFF]/10 text-[#DFC4FF]">
                      <Search className="h-4 w-4" />
                    </div>

                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold text-white">Enter your storefront domain</h3>
                      <p className="mt-1 text-sm leading-6 text-white/58">
                        Paste a raw domain like <span className="text-white/78">shogun.mx</span> or a
                        full URL like <span className="text-white/78">https://shogun.mx</span>. We will
                        detect the storefront type from the homepage.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    <Input
                      value={domainInput}
                      onChange={(event) => setDomainInput(event.target.value)}
                      placeholder="Enter your domain"
                      autoFocus
                      className="h-12 rounded-2xl border-white/10 bg-[#0F0D18] px-4 text-white placeholder:text-white/28 focus-visible:ring-[#B55CFF]/55"
                    />

                    <p className="text-xs text-white/42">
                      We only inspect the storefront homepage to suggest the platform. You will still
                      confirm the result before continuing.
                    </p>
                  </div>
                </div>

                {error ? (
                  <div className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 rounded-2xl border border-white/10 bg-white/[0.03] px-5 text-white/70 hover:bg-white/[0.06] hover:text-white"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>

                  <Button
                    type="submit"
                    disabled={isDetecting}
                    className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.18)] hover:bg-[#A864FF]"
                  >
                    {isDetecting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Detecting store type
                      </>
                    ) : (
                      <>
                        Detect store type
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </form>
            ) : null}

            {step === "confirm" && detection ? (
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
                      <div className="text-[11px] uppercase tracking-[0.2em] text-white/38">
                        Matched signals
                      </div>
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

                          <span
                            className={cn(
                              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                              selected
                                ? "border-[#C98BFF]/50 bg-[#B55CFF]/18 text-white"
                                : "border-white/14 bg-white/[0.03] text-transparent"
                            )}
                          >
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
                    onClick={() => {
                      setStep("domain");
                      setError("");
                    }}
                  >
                    Back
                  </Button>

                  <Button
                    type="button"
                    className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.18)] hover:bg-[#A864FF]"
                    onClick={() => setStep("instructions")}
                  >
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}

            {step === "instructions" && detection ? (
              <div className="space-y-6">
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
                              Download the plugin ZIP, upload it in WordPress, then activate it. The
                              ZIP already includes the Adray pixel and is ready to install.
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
                        {
                          title: "Download the plugin ZIP",
                          body: "Use the download button above. This package already includes the Adray pixel and is ready to upload.",
                        },
                        {
                          title: "Open your WordPress Plugins screen",
                          body: `Go to ${suggestedPluginsUrl || `${detection.normalizedUrl}wp-admin/plugins.php`} in your site admin.`,
                        },
                        {
                          title: "Click Add Plugin, then Upload Plugin",
                          body: "Choose the ZIP you just downloaded from Adray.",
                        },
                        {
                          title: "Click Install",
                          body: "Wait a few seconds while WordPress uploads and installs the plugin.",
                        },
                        {
                          title: "Activate the plugin",
                          body: "Click Activate and your Adray pixel will be live on the store.",
                        },
                      ].map((item, index) => (
                        <div
                          key={item.title}
                          className="rounded-[22px] border border-white/10 bg-[#0F0D18] px-4 py-4"
                        >
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
                          We can already detect this storefront type, but the guided install flow is
                          only available for WooCommerce right now. You can go back and change the
                          selection if needed.
                        </p>

                        {selectedTypeOption ? (
                          <p className="mt-4 text-sm leading-6 text-white/46">{selectedTypeOption.blurb}</p>
                        ) : null}
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

                  <Button
                    type="button"
                    className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-white shadow-[0_0_24px_rgba(181,92,255,0.18)] hover:bg-[#A864FF]"
                    onClick={() => onOpenChange(false)}
                  >
                    Done
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
