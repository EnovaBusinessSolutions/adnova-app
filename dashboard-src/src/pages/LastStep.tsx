import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import {
  ArrowLeft,
  Sparkles,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Wand2,
  FileText,
  Download,
  LockKeyhole,
  Bot,
  ShieldCheck,
} from "lucide-react";

type BuildStage =
  | "idle"
  | "loading_sources"
  | "compacting_sources"
  | "encoding_context"
  | "completed"
  | "failed";

type ContextStatusResponse = {
  ok?: boolean;
  data?: {
    status?: "idle" | "processing" | "done" | "error";
    progress?: number;
    stage?: BuildStage | string;
    startedAt?: string | null;
    finishedAt?: string | null;
    snapshotId?: string | null;
    hasEncodedPayload?: boolean;
    providerAgnostic?: boolean;
    usedOpenAI?: boolean;
    model?: string | null;
    error?: string | null;
  };
};

type SupportedModel = {
  key: string;
  title: string;
  logoSrc: string;
  accent: "purple" | "emerald" | "blue" | "silver";
};

async function apiJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(json?.error || json?.message || `HTTP_${res.status}`);
  }

  return json as T;
}

function clampProgress(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function stageLabel(stage: string, usedOpenAI?: boolean) {
  switch (stage) {
    case "loading_sources":
      return "Collecting connected datasets";
    case "compacting_sources":
      return "Compacting marketing data";
    case "encoding_context":
      return usedOpenAI ? "Encoding AI-ready context" : "Preparing universal context";
    case "completed":
      return "Your PDF source context is ready";
    case "failed":
      return "Context build failed";
    default:
      return "Preparing your AI context";
  }
}

function stageHint(stage: string) {
  switch (stage) {
    case "loading_sources":
      return "We’re reading Meta Ads, Google Ads, and GA4 from your MCP snapshot.";
    case "compacting_sources":
      return "We’re transforming your channel data into a unified marketing context.";
    case "encoding_context":
      return "We’re generating the final premium payload that will power your exported PDF.";
    case "completed":
      return "Your data is encoded and ready to generate a premium PDF for your favorite AI tools.";
    case "failed":
      return "Something interrupted the encoding flow. Retry to continue.";
    default:
      return "This usually takes a few seconds while we prepare your cross-channel data.";
  }
}

function StepProgress({ step }: { step: 1 | 2 }) {
  const isStep2 = step === 2;

  const pillBase =
    "inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] transition-all";

  const active =
    "border-[#B55CFF]/45 bg-[#B55CFF]/[0.10] text-white shadow-[0_0_18px_rgba(181,92,255,0.12)]";
  const done = "border-white/10 bg-white/[0.04] text-white/82";
  const pending = "border-white/10 bg-white/[0.02] text-white/52";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={[pillBase, done].join(" ")}>
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#B55CFF]" />
        Step 1: Activate Data
      </span>

      <span className={[pillBase, isStep2 ? active : pending].join(" ")}>
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#4FE3C1]" />
        Step 2: Export PDF
      </span>
    </div>
  );
}

function BuildProgressPanel({
  visible,
  progress,
  status,
  stage,
  usedOpenAI,
  model,
  error,
  onRetry,
}: {
  visible: boolean;
  progress: number;
  status: "idle" | "processing" | "done" | "error";
  stage: string;
  usedOpenAI: boolean;
  model: string | null;
  error: string | null;
  onRetry: () => void;
}) {
  if (!visible) return null;

  const label = stageLabel(stage, usedOpenAI);
  const hint = stageHint(stage);

  return (
    <div className="mt-6">
      <div className="relative overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <div className="absolute inset-0 pointer-events-none opacity-70">
          <div className="absolute -top-20 left-0 h-56 w-56 rounded-full blur-3xl bg-[#B55CFF]/14" />
          <div className="absolute -bottom-20 right-0 h-56 w-56 rounded-full blur-3xl bg-[#4FE3C1]/10" />
        </div>

        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#B55CFF]/18 bg-[#B55CFF]/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#E7D3FF]">
                <Sparkles className="h-3.5 w-3.5" />
                AI Context Builder
              </div>

              <div className="mt-4 text-xl font-bold text-white/95 sm:text-2xl">{label}</div>

              <p className="mt-2 max-w-2xl text-sm leading-7 text-white/58">{hint}</p>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-3xl font-extrabold text-white/95 sm:text-4xl">{progress}%</div>
              <div className="mt-1 text-xs text-white/45">
                {usedOpenAI ? `Powered by ${model || "OpenAI"}` : "Preparing universal context"}
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[24px] border border-white/10 bg-[#090A0D]/80 p-4">
            <div className="h-3 w-full overflow-hidden rounded-full border border-white/10 bg-white/[0.05]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#B55CFF_0%,#D66BFF_55%,#4FE3C1_100%)] shadow-[0_0_20px_rgba(181,92,255,0.35)] transition-[width] duration-700 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-white/58">
                {status === "error" ? (
                  <span className="inline-flex h-2 w-2 rounded-full bg-red-400" />
                ) : status === "done" ? (
                  <span className="inline-flex h-2 w-2 rounded-full bg-[#4FE3C1]" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#B55CFF]" />
                )}

                <span>
                  {status === "error"
                    ? "Build interrupted"
                    : status === "done"
                      ? "Encoding completed"
                      : "Encoding in progress"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/68">
                  {stage.split("_").join(" ")}
                </span>

                {error ? (
                  <span className="rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-1 text-[11px] text-red-200/85">
                    {error}
                  </span>
                ) : null}

                {status === "error" ? (
                  <Button
                    size="sm"
                    onClick={onRetry}
                    className="rounded-xl bg-[#B55CFF] text-white hover:bg-[#A64DFA]"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PdfLaunchCard({
  ready,
  onGenerate,
}: {
  ready: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <div className="absolute inset-0 pointer-events-none opacity-70">
        <div className="absolute -top-20 right-0 h-56 w-56 rounded-full blur-3xl bg-[#4FE3C1]/12" />
        <div className="absolute -bottom-20 left-0 h-56 w-56 rounded-full blur-3xl bg-[#B55CFF]/14" />
      </div>

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#4FE3C1]/18 bg-[#4FE3C1]/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#CFFFF0]">
            <FileText className="h-3.5 w-3.5" />
            PDF Export
          </div>

          <h2 className="mt-4 text-2xl font-bold tracking-tight text-white/95 sm:text-3xl">
            Generate your premium PDF
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-7 text-white/56 sm:text-base">
            One clean export. Built from your full Adray context.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-white/68">
              <ShieldCheck className="h-3.5 w-3.5 text-[#4FE3C1]" />
              Unified context
            </span>

            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-white/68">
              <Sparkles className="h-3.5 w-3.5 text-[#B55CFF]" />
              Premium formatting
            </span>
          </div>
        </div>

        <div className="w-full lg:w-auto">
          <div className="rounded-[26px] border border-white/10 bg-[#090A0D]/80 p-4 sm:p-5 lg:min-w-[320px]">
            <div className="flex items-center gap-3">
              <span
                className={[
                  "inline-flex h-11 w-11 items-center justify-center rounded-2xl border",
                  ready
                    ? "border-[#4FE3C1]/25 bg-[#4FE3C1]/10"
                    : "border-white/10 bg-white/[0.04]",
                ].join(" ")}
              >
                {ready ? (
                  <FileText className="h-5 w-5 text-[#4FE3C1]" />
                ) : (
                  <LockKeyhole className="h-5 w-5 text-white/55" />
                )}
              </span>

              <div>
                <p className="text-sm font-semibold text-white/92">
                  {ready ? "PDF generation unlocked" : "Waiting for context"}
                </p>
                <p className="mt-1 text-xs text-white/48">
                  {ready ? "Ready for backend connection." : "Unlocks automatically when build finishes."}
                </p>
              </div>
            </div>

            <Button
              onClick={onGenerate}
              disabled={!ready}
              className={[
                "mt-5 h-12 w-full rounded-2xl px-5 text-white",
                ready
                  ? "bg-[#B55CFF] hover:bg-[#A664FF] shadow-[0_0_24px_rgba(181,92,255,0.24)]"
                  : "bg-white/[0.06] text-white/55 hover:bg-white/[0.06]",
              ].join(" ")}
            >
              {ready ? (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Generate PDF
                </>
              ) : (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Preparing PDF
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelCompatibilityCard({
  title,
  logoSrc,
  accent,
}: {
  title: string;
  logoSrc: string;
  accent: "purple" | "emerald" | "blue" | "silver";
}) {
  const theme =
    accent === "emerald"
      ? {
          border: "border-[#4FE3C1]/14",
          hover: "hover:border-[#4FE3C1]/28",
          glowA: "bg-[#4FE3C1]/12",
          glowB: "bg-[#B55CFF]/8",
          dot: "bg-[#4FE3C1]",
        }
      : accent === "blue"
        ? {
            border: "border-[#A7D6FF]/14",
            hover: "hover:border-[#A7D6FF]/28",
            glowA: "bg-[#A7D6FF]/12",
            glowB: "bg-[#B55CFF]/8",
            dot: "bg-[#A7D6FF]",
          }
        : accent === "silver"
          ? {
              border: "border-white/12",
              hover: "hover:border-white/24",
              glowA: "bg-white/[0.08]",
              glowB: "bg-[#B55CFF]/8",
              dot: "bg-white/70",
            }
          : {
              border: "border-[#D9C7FF]/14",
              hover: "hover:border-[#D9C7FF]/28",
              glowA: "bg-[#D9C7FF]/12",
              glowB: "bg-[#B55CFF]/8",
              dot: "bg-[#D9C7FF]",
            };

  return (
    <div
      className={[
        "group relative min-h-[170px] overflow-hidden rounded-[26px] border bg-white/[0.02] p-5 transition-all sm:min-h-[190px]",
        theme.border,
        theme.hover,
        "hover:bg-white/[0.03]",
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className={["absolute -top-16 right-0 h-36 w-36 rounded-full blur-3xl", theme.glowA].join(" ")} />
        <div className={["absolute -bottom-16 left-0 h-32 w-32 rounded-full blur-3xl", theme.glowB].join(" ")} />
      </div>

      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-end">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/68">
            <span className={["inline-block h-1.5 w-1.5 rounded-full", theme.dot].join(" ")} />
            Compatible
          </span>
        </div>

        <div className="mt-6 flex min-h-[72px] items-center justify-center">
          <img
            src={logoSrc}
            alt={title}
            className="max-h-[42px] w-auto object-contain opacity-95 transition-transform duration-300 group-hover:scale-[1.03] sm:max-h-[48px]"
            draggable={false}
          />
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm font-medium text-white/88">{title}</p>
        </div>
      </div>
    </div>
  );
}

export default function LastStep() {
  const nav = useNavigate();

  const [buildStatus, setBuildStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [buildStage, setBuildStage] = useState<string>("idle");
  const [serverProgress, setServerProgress] = useState(0);
  const [visualProgress, setVisualProgress] = useState(0);
  const [hasEncodedPayload, setHasEncodedPayload] = useState(false);
  const [usedOpenAI, setUsedOpenAI] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const pollingRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const isReady = buildStatus === "done" && hasEncodedPayload;
  const showBuilder = !isReady;

  const supportedModels: SupportedModel[] = [
    {
      key: "chatgpt",
      title: "ChatGPT",
      logoSrc: "/logos/chatgpt.png",
      accent: "emerald",
    },
    {
      key: "claude",
      title: "Claude",
      logoSrc: "/logos/claude.png",
      accent: "purple",
    },
    {
      key: "gemini",
      title: "Gemini",
      logoSrc: "/logos/gemini.png",
      accent: "blue",
    },
    {
      key: "grok",
      title: "Grok",
      logoSrc: "/logos/grok.png",
      accent: "silver",
    },
    {
      key: "deepseek",
      title: "DeepSeek",
      logoSrc: "/logos/deepseek.png",
      accent: "blue",
    },
    {
      key: "metaai",
      title: "Meta AI",
      logoSrc: "/logos/metaai.png",
      accent: "purple",
    },
  ];

  const showToast = (text: string) => {
    setToast(text);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1800);
  };

  const syncStatus = (payload?: ContextStatusResponse["data"]) => {
    const status = payload?.status || "idle";
    const progress = clampProgress(payload?.progress ?? 0);
    const stage = payload?.stage || "idle";

    setBuildStatus(status);
    setBuildStage(stage);
    setServerProgress(progress);
    setHasEncodedPayload(!!payload?.hasEncodedPayload);
    setUsedOpenAI(!!payload?.usedOpenAI);
    setModel(payload?.model || null);
    setBuildError(payload?.error || null);
  };

  const stopPolling = () => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const fetchStatus = async () => {
    const json = await apiJson<ContextStatusResponse>("/api/mcp/context/status");
    syncStatus(json?.data);
    return json?.data;
  };

  const buildContext = async () => {
    setBuildError(null);

    const json = await apiJson<ContextStatusResponse>("/api/mcp/context/build", {
      method: "POST",
      body: JSON.stringify({}),
    });

    syncStatus(json?.data);
    return json?.data;
  };

  const startPolling = () => {
    if (pollingRef.current) return;

    pollingRef.current = window.setInterval(async () => {
      try {
        const next = await fetchStatus();
        if (next?.status === "done" || next?.status === "error") {
          stopPolling();
        }
      } catch {
        // noop
      }
    }, 1500);
  };

  const ensureBuild = async () => {
    try {
      const current = await fetchStatus();

      if (current?.status === "done" && current?.hasEncodedPayload) {
        stopPolling();
        return;
      }

      if (current?.status === "processing") {
        startPolling();
        return;
      }

      const built = await buildContext();

      if (built?.status === "done") {
        await fetchStatus();
        stopPolling();
        return;
      }

      if (built?.status === "processing") {
        startPolling();
      }
    } catch (err: any) {
      setBuildStatus("error");
      setBuildStage("failed");
      setBuildError(err?.message || "Failed to build AI context");
      setServerProgress(100);
      stopPolling();
    }
  };

  useEffect(() => {
    ensureBuild();

    return () => {
      stopPolling();
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (buildStatus === "done") {
      setVisualProgress(100);
      return;
    }

    if (buildStatus === "error") {
      setVisualProgress((prev) => (prev < serverProgress ? serverProgress : prev));
      return;
    }

    const id = window.setInterval(() => {
      setVisualProgress((prev) => {
        const target = serverProgress;
        if (prev >= target) return prev;
        const step = target - prev > 20 ? 6 : target - prev > 10 ? 4 : 2;
        return Math.min(target, prev + step);
      });
    }, 120);

    return () => window.clearInterval(id);
  }, [serverProgress, buildStatus]);

  const onRetry = async () => {
    setHasEncodedPayload(false);
    setUsedOpenAI(false);
    setModel(null);
    setBuildError(null);
    setServerProgress(0);
    setVisualProgress(0);
    setBuildStatus("idle");
    setBuildStage("idle");
    stopPolling();
    await ensureBuild();
  };

  const onGeneratePdf = () => {
    if (!isReady) return;
    showToast("PDF generation will be connected soon");
  };

  const tipText = useMemo(() => {
    if (isReady) {
      return "Your context is ready. The next step is connecting the PDF export backend.";
    }
    return "We’re encoding your connected marketing data before unlocking PDF export.";
  }, [isReady]);

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[#0B0B0D]">
        <div className="p-4 sm:p-6">
          <Card className="glass-effect overflow-hidden border-[#2C2530] bg-[#0F1012]">
            <div className="relative">
              <div className="absolute inset-0 pointer-events-none opacity-55">
                <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full blur-3xl bg-[#B55CFF]/18" />
                <div className="absolute top-28 left-0 h-72 w-72 rounded-full blur-3xl bg-[#4FE3C1]/8" />
                <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full blur-3xl bg-white/[0.03]" />
              </div>

              <CardContent className="relative p-4 sm:p-6">
                <style>{`
                  @keyframes heroFloat {
                    0% { transform: translateY(0px); }
                    50% { transform: translateY(-8px); }
                    100% { transform: translateY(0px); }
                  }

                  @keyframes toastPop {
                    0% { transform: translateY(8px); opacity: 0; }
                    100% { transform: translateY(0px); opacity: 1; }
                  }

                  .laststep-hero-bg::before {
                    content: "";
                    position: absolute;
                    inset: -10%;
                    background:
                      radial-gradient(720px 260px at 12% 18%, rgba(181,92,255,0.18), transparent 60%),
                      radial-gradient(620px 220px at 88% 18%, rgba(79,227,193,0.12), transparent 60%),
                      radial-gradient(660px 260px at 50% 100%, rgba(255,255,255,0.05), transparent 65%);
                    animation: heroFloat 7s ease-in-out infinite;
                  }
                `}</style>

                <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.02] p-5 sm:p-8 laststep-hero-bg">
                  <div className="relative z-10">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <StepProgress step={2} />

                      <Button
                        variant="ghost"
                        onClick={() => nav("/")}
                        className="text-white/80 hover:bg-white/[0.06]"
                      >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back
                      </Button>
                    </div>

                    <div className="mt-6 max-w-4xl">
                      <div className="inline-flex items-center gap-2 rounded-full border border-[#B55CFF]/20 bg-[#B55CFF]/10 px-3 py-1 text-xs text-[#E7D3FF]">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {isReady
                          ? "Your AI context is encoded and PDF-ready"
                          : "Preparing your universal AI-ready context"}
                      </div>

                      <div className="mt-5 flex items-start gap-4">
                        <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#B55CFF]/20 bg-[#B55CFF]/10 sm:inline-flex">
                          <Wand2 className="h-5 w-5 text-[#D2A7FF]" />
                        </div>

                        <div className="min-w-0">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                            Final Step
                          </p>

                          <h1 className="mt-2 text-3xl font-extrabold leading-[1.04] tracking-tight text-white/95 sm:text-5xl">
                            Export your{" "}
                            <span className="bg-gradient-to-r from-[#B55CFF] via-white to-[#4FE3C1] bg-clip-text text-transparent">
                              AI PDF
                            </span>
                          </h1>

                          <p className="mt-4 max-w-2xl text-sm leading-7 text-white/56 sm:text-base">
                            Generate a premium PDF from your unified Adray context, ready for your favorite AI tools.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <BuildProgressPanel
                  visible={showBuilder}
                  progress={visualProgress}
                  status={buildStatus}
                  stage={buildStage}
                  usedOpenAI={usedOpenAI}
                  model={model}
                  error={buildError}
                  onRetry={onRetry}
                />

                <div className="mt-6">
                  <PdfLaunchCard ready={isReady} onGenerate={onGeneratePdf} />
                </div>

                <div className="mt-6 rounded-[30px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
                  <div className="max-w-2xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/72">
                      <Bot className="h-3.5 w-3.5" />
                      AI Compatibility
                    </div>

                    <h3 className="mt-4 text-2xl font-bold tracking-tight text-white/95 sm:text-3xl">
                      Works with top AI models
                    </h3>

                    <p className="mt-2 text-sm leading-7 text-white/52">
                      Export once, then use your PDF wherever you work best.
                    </p>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {supportedModels.map((item) => (
                      <ModelCompatibilityCard
                        key={item.key}
                        title={item.title}
                        logoSrc={item.logoSrc}
                        accent={item.accent}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/55">
                  Tip: {tipText}
                </div>

                {toast ? (
                  <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 animate-[toastPop_.18s_ease-out]">
                    <div className="rounded-full border border-white/10 bg-black/75 px-4 py-2 text-xs text-white/92 shadow-[0_0_24px_rgba(181,92,255,0.18)]">
                      {toast}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}