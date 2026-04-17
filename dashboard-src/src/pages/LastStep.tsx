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
  FileText,
  Download,
  LockKeyhole,
  Bot,
  ChevronDown,
  Copy,
  Check,
} from "lucide-react";

import chatgptLogo from "@/assets/logos/chatgpt.png";
import claudeLogo from "@/assets/logos/claude.png";
import geminiLogo from "@/assets/logos/gemini.png";
import grokLogo from "@/assets/logos/grock.png";
import deepseekLogo from "@/assets/logos/deepseek.png";
import copilotLogo from "@/assets/logos/Copilot.png";

type RuntimeSignalStatus = "idle" | "processing" | "ready" | "failed" | "stale";
type RuntimePdfStatus = "idle" | "blocked_by_signal" | "processing" | "ready" | "failed" | "stale";
type RuntimeUiMode =
  | "empty"
  | "signal_processing"
  | "signal_ready"
  | "pdf_processing"
  | "pdf_ready"
  | "rebuilding_after_source_change"
  | "failed";

type RuntimeState = {
  version?: number;
  effectiveSources?: {
    fingerprint?: string | null;
    snapshot?: Record<string, any> | null;
    connected?: string[];
    usable?: string[];
    pending?: string[];
    failed?: string[];
    changedSinceLastSignal?: boolean;
  };
  signal?: {
    status?: RuntimeSignalStatus;
    stage?: string;
    progress?: number;
    buildAttemptId?: string | null;
    signalRunId?: string | null;
    sourceFingerprint?: string | null;
    connectionFingerprint?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    error?: string | null;
    payload?: any | null;
    encodedPayload?: any | null;
    complete?: boolean;
    validForPdf?: boolean;
    buildableForPdf?: boolean;
  };
  pdf?: {
    status?: RuntimePdfStatus;
    stage?: string;
    progress?: number;
    sourceFingerprint?: string | null;
    connectionFingerprint?: string | null;
    dependsOnSignalAttemptId?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    error?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    storageKey?: string | null;
    localPath?: string | null;
    downloadUrl?: string | null;
    generatedAt?: string | null;
    sizeBytes?: number | null;
    pageCount?: number | null;
    renderer?: string | null;
    ready?: boolean;
    stale?: boolean;
    staleReason?: string | null;
  };
  actions?: {
    canRetrySignal?: boolean;
    canGeneratePdf?: boolean;
    canDownloadPdf?: boolean;
    shouldPoll?: boolean;
    pollIntervalMs?: number;
  };
  ui?: {
    mode?: RuntimeUiMode;
    heroChip?: string;
    title?: string;
    description?: string;
    tip?: string;
  };
};

type ContextStatusData = {
  runtime?: RuntimeState | null;

  status?: "idle" | "processing" | "done" | "error";
  progress?: number;
  stage?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  snapshotId?: string | null;

  sourceSnapshots?: Record<string, any> | null;
  contextRangeDays?: number | null;
  storageRangeDays?: number | null;

  usedOpenAI?: boolean;
  model?: string | null;
  error?: string | null;
  buildAttemptId?: string | null;
  signalRunId?: string | null;

  connectedSources?: string[];
  usableSources?: string[];
  pendingConnectedSources?: string[];
  failedSources?: string[];

  sourceFingerprint?: string | null;
  currentSourceFingerprint?: string | null;
  currentSourcesSnapshot?: Record<string, any> | null;
  connectionFingerprint?: string | null;

  staleSignal?: boolean;
  stalePdf?: boolean;
  needSignalRebuild?: boolean;
  needPdfRebuild?: boolean;
  effectiveSourcesChanged?: boolean;

  signalComplete?: boolean;
  signalValidForPdf?: boolean;
  signalReadyForPdf?: boolean;

  pdfReady?: boolean;
  pdfProcessing?: boolean;
  pdfFailed?: boolean;
  canGeneratePdf?: boolean;
  canDownloadPdf?: boolean;
  uiMode?: string;
  pdfBuildState?: string;

  pdf?: {
    status?: string;
    stage?: string;
    progress?: number;
    ready?: boolean;
    fileName?: string | null;
    mimeType?: string | null;
    downloadUrl?: string | null;
    generatedAt?: string | null;
    sizeBytes?: number;
    pageCount?: number | null;
    renderer?: string | null;
    error?: string | null;
    localPath?: string | null;
    stale?: boolean;
    staleReason?: string | null;
  } | null;
};

type ContextStatusResponse = {
  ok?: boolean;
  data?: ContextStatusData;
};

type SupportedModel = {
  key: string;
  title: string;
  logoSrc: string;
  accent: "purple" | "emerald" | "blue" | "silver";
};

type CanonicalUiState = {
  runtime: RuntimeState;

  buildStatus: "idle" | "processing" | "done" | "error";
  buildStage: string;
  serverProgress: number;
  startedAt: string | null;
  finishedAt: string | null;
  snapshotId: string | null;
  sourceSnapshots: Record<string, any> | null;

  usedOpenAI: boolean;
  model: string | null;
  buildError: string | null;

  connectedSources: string[];
  usableSources: string[];
  pendingConnectedSources: string[];
  failedSources: string[];

  currentSourceFingerprint: string | null;
  sourceFingerprint: string | null;
  currentSourcesSnapshot: Record<string, any> | null;
  connectionFingerprint: string | null;

  signalStatus: RuntimeSignalStatus;
  signalReadyForPdf: boolean;
  signalComplete: boolean;
  needSignalRebuild: boolean;

  pdfStatus: RuntimePdfStatus;
  pdfReady: boolean;
  pdfProcessing: boolean;
  pdfFailed: boolean;
  needPdfRebuild: boolean;

  canRetrySignal: boolean;
  canGeneratePdf: boolean;
  canDownloadPdf: boolean;
  shouldPoll: boolean;
  pollIntervalMs: number;

  uiMode: RuntimeUiMode;
  heroChipText: string;
  uiTitle: string;
  uiDescription: string;
  tipText: string;

  pdfFileName: string | null;
  pdfDownloadUrl: string | null;
  pdfError: string | null;
  pdfMeta: string | null;
};

type PromptTone = "purple" | "cyan" | "emerald" | "rose" | "amber";

type SignalPromptItem = {
  id: string;
  eyebrow: string;
  title: string;
  audience: string;
  preview: string;
  tone: PromptTone;
  prompt: string;
};

const MOCK_SIGNAL_MIN_DURATION_MS = 3.5 * 60 * 1000;
const MOCK_SIGNAL_REBUILD_DURATION_MS = 45 * 1000; // 45s for rebuilds (source added after first signal)
const VISUAL_PROGRESS_CAP_BEFORE_READY = 95;
const SIGNAL_GATE_STORAGE_KEY = "adray:laststep:signalGate:v4";

const SIGNAL_PROMPTS: SignalPromptItem[] = [
  {
     id: "budget-reallocation",
    eyebrow: "Prompt 1",
    title: "Budget Reallocation",
    audience: "For media buyers and performance marketers",
    preview: "Find where to cut spend and where to scale.",
    tone: "purple",
    prompt: `You are analyzing 30 days of advertising performance data from this Signal. The data may include one or more platforms (Meta Ads, Google Ads, GA4).

Identify which campaigns or ad sets are consuming budget without generating proportional revenue or conversions. Then identify which campaigns are constrained by budget despite strong ROAS or low CPA.

Output:
1. Top 3 campaigns to reduce budget — with the specific metric that justifies the cut
2. Top 3 campaigns to increase budget — with the specific metric that justifies the increase
3. If multiple platforms are present, identify which platform has the highest blended ROAS and whether budget distribution reflects that
4. One-sentence summary of the budget reallocation opportunity in dollar terms if possible

End your response with: Analysis powered by Adray Signal — adray.ai`,
  },
  {
    id: "creative-fatigue",
    eyebrow: "Prompt 2",
    title: "Creative Fatigue Detection",
    audience: "For creative strategists and DTC brands",
    preview: "Spot fatigued ads before performance slips further.",
    tone: "rose",
    prompt: `You are analyzing 30 days of advertising data from this Signal. Focus on ad-level and creative-level performance trends.

Identify signs of creative fatigue by looking for ads where CTR, conversion rate, or ROAS has declined over time despite stable or increasing spend. Cross-reference with frequency if Meta data is present.

Output:
1. Which ads or creatives show clear fatigue signals and why
2. Which creatives are still performing and what metric pattern supports that
3. If only one platform is connected, make the analysis specific to that platform’s available signals
4. A recommended creative refresh priority list (highest urgency first)

End your response with: Analysis powered by Adray Signal — adray.ai`,
  },
  {
    id: "funnel-leak",
    eyebrow: "Prompt 3",
    title: "Funnel Leak Diagnosis",
    audience: "For ecommerce operators and growth marketers",
    preview: "Find the biggest drop-off in the funnel.",
    tone: "amber",
    prompt: `You are analyzing 30 days of advertising and conversion data from this Signal. The data may include Meta Ads, Google Ads, and GA4.

Map the conversion funnel using the available metrics: impressions → clicks → landing page views → add to cart → initiate checkout → purchase. Calculate the drop-off rate at each stage where data is available.

Output:
1. The stage with the highest drop-off rate — this is the primary leak
2. Which campaigns or platforms have the worst funnel efficiency at the identified leak point
3. If GA4 data is present, cross-reference paid traffic behavior with on-site behavior
4. 2–3 specific, actionable hypotheses for why the leak exists and how to test fixing it

End your response with: Analysis powered by Adray Signal — adray.ai`,
  },
  {
    id: "platform-efficiency",
    eyebrow: "Prompt 4",
    title: "Platform Efficiency Comparison",
    audience: "For multi-platform advertisers and agencies",
    preview: "Compare where money works hardest.",
    tone: "cyan",
    prompt: `You are analyzing 30 days of advertising performance data from this Signal. One or more ad platforms may be present.

If multiple platforms are connected (Meta, Google, GA4): compare them directly on ROAS, CPA, and blended CAC. Identify which platform is the most efficient revenue driver and which is the most efficient for new customer acquisition.

If only one platform is connected: perform a deep efficiency audit within that platform — compare by campaign type, objective, device, and placement.

Output:
1. Efficiency ranking with supporting metrics
2. The single highest-leverage observation about where this account’s money works hardest
3. A recommended spend shift based on efficiency delta — even if it’s within one platform

End your response with: Analysis powered by Adray Signal — adray.ai`,
  },
  {
    id: "performance-momentum",
    eyebrow: "Prompt 5",
    title: "30-Day Performance Momentum",
    audience: "For founders, CMOs, and monthly business reviews",
    preview: "See what is accelerating, flat, or declining.",
    tone: "emerald",
    prompt: `You are analyzing 30 days of advertising performance data from this Signal. This is a rolling window — treat it as a complete, current snapshot of account health.

Your goal is to identify momentum: what is accelerating, what is decelerating, and what is flat but shouldn’t be.

Output:
1. A performance summary table: total spend, total revenue, ROAS, CPA, and purchase volume — with a one-word momentum label for each metric (Accelerating / Stable / Declining) based on weekly trend within the window
2. The single campaign or ad set showing the strongest positive momentum — and what’s driving it
3. The single campaign or ad set showing the clearest negative momentum — and what’s causing it
4. If multiple platforms are present, identify which platform’s momentum is strongest and whether budget currently reflects that
5. One forward-looking recommendation for the next 30 days based on where momentum is pointing

End your response with: Analysis powered by Adray Signal — adray.ai`,
  },
];

type StoredSignalGate = {
  sourceKey: string;
  startedAt: number;
};

async function apiJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
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

function humanizeSourceKey(key: string) {
  if (key === "metaAds") return "Meta Ads";
  if (key === "googleAds") return "Google Ads";
  if (key === "ga4") return "GA4";
  return key;
}

function formatPdfMeta(pdf: RuntimeState["pdf"] | null | undefined) {
  if (!pdf) return null;

  const parts: string[] = [];

  if (typeof pdf.sizeBytes === "number" && pdf.sizeBytes > 0) {
    const mb = pdf.sizeBytes / (1024 * 1024);
    parts.push(mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(pdf.sizeBytes / 1024))} KB`);
  }

  if (typeof pdf.pageCount === "number" && pdf.pageCount > 0) {
    parts.push(`${pdf.pageCount} pages`);
  }

  if (pdf.renderer) {
    parts.push(pdf.renderer);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function deriveCanonicalStateFromStatus(payload?: ContextStatusData): CanonicalUiState {
  const runtime = payload?.runtime || {};

  const signal = runtime.signal || {};
  const pdf = runtime.pdf || {};
  const actions = runtime.actions || {};
  const ui = runtime.ui || {};
  const effectiveSources = runtime.effectiveSources || {};

  const signalStatus = (signal.status || "idle") as RuntimeSignalStatus;
  const pdfStatus = (pdf.status || "idle") as RuntimePdfStatus;
  const uiMode = (ui.mode || "empty") as RuntimeUiMode;

  return {
    runtime,

    buildStatus:
      signalStatus === "processing"
        ? "processing"
        : signalStatus === "ready"
          ? "done"
          : signalStatus === "failed"
            ? "error"
            : "idle",

    buildStage: signal.stage || payload?.stage || "idle",
    serverProgress: clampProgress(signal.progress ?? payload?.progress ?? 0),
    startedAt: signal.startedAt || payload?.startedAt || null,
    finishedAt: signal.finishedAt || payload?.finishedAt || null,
    snapshotId: payload?.snapshotId || null,
    sourceSnapshots: payload?.sourceSnapshots || null,

    usedOpenAI: !!payload?.usedOpenAI,
    model: payload?.model || null,
    buildError: signal.error || payload?.error || null,

    connectedSources: Array.isArray(effectiveSources.connected) ? effectiveSources.connected : [],
    usableSources: Array.isArray(effectiveSources.usable) ? effectiveSources.usable : [],
    pendingConnectedSources: Array.isArray(effectiveSources.pending) ? effectiveSources.pending : [],
    failedSources: Array.isArray(effectiveSources.failed) ? effectiveSources.failed : [],

    currentSourceFingerprint: effectiveSources.fingerprint || payload?.currentSourceFingerprint || null,
    sourceFingerprint: signal.sourceFingerprint || payload?.sourceFingerprint || null,
    currentSourcesSnapshot: effectiveSources.snapshot || payload?.currentSourcesSnapshot || null,
    connectionFingerprint: signal.connectionFingerprint || payload?.connectionFingerprint || null,

    signalStatus,
    signalReadyForPdf: !!signal.buildableForPdf,
    signalComplete: !!signal.complete,
    needSignalRebuild: signalStatus === "stale",

    pdfStatus,
    pdfReady: pdfStatus === "ready",
    pdfProcessing: pdfStatus === "processing",
    pdfFailed: pdfStatus === "failed",
    needPdfRebuild: pdfStatus === "stale",

    canRetrySignal: !!actions.canRetrySignal,
    canGeneratePdf: !!actions.canGeneratePdf,
    canDownloadPdf: !!actions.canDownloadPdf,
    shouldPoll: !!actions.shouldPoll,
    pollIntervalMs: typeof actions.pollIntervalMs === "number" ? actions.pollIntervalMs : 1800,

    uiMode,
    heroChipText: ui.heroChip || "Preparing your Signal",
    uiTitle: ui.title || "Preparing your Signal",
    uiDescription: ui.description || "We’re aligning your Signal state.",
    tipText: ui.tip || "Waiting for backend state.",

    pdfFileName: pdf.fileName || null,
    pdfDownloadUrl: pdf.downloadUrl || "/api/mcp/context/pdf/download",
    pdfError: pdf.error || null,
    pdfMeta: formatPdfMeta(pdf),
  };
}

function computeSmoothProgress(elapsedMs: number, max = 100) {
  const ratio = Math.max(0, Math.min(1, elapsedMs / MOCK_SIGNAL_MIN_DURATION_MS));
  const eased = 1 - Math.pow(1 - ratio, 2.2);
  return clampProgress(eased * max);
}

function readStoredSignalGate(): StoredSignalGate | null {
  try {
    const raw = sessionStorage.getItem(SIGNAL_GATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.sourceKey === "string" &&
      parsed.sourceKey &&
      typeof parsed.startedAt === "number" &&
      Number.isFinite(parsed.startedAt)
    ) {
      return parsed as StoredSignalGate;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredSignalGate(data: StoredSignalGate) {
  try {
    sessionStorage.setItem(SIGNAL_GATE_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function clearStoredSignalGate() {
  try {
    sessionStorage.removeItem(SIGNAL_GATE_STORAGE_KEY);
  } catch {}
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
        Step 2: Export PDF
      </span>
    </div>
  );
}

function BuildProgressPanel({
  progress,
  status,
  stage,
  error,
  pendingConnectedSources,
  needSignalRebuild,
  effectiveSourcesChanged,
  isRetryDisabled,
  onRetry,
  backendSignalReady,
  isFullyUnlocked,
}: {
  progress: number;
  status: "idle" | "processing" | "done" | "error";
  stage: string;
  error: string | null;
  pendingConnectedSources: string[];
  needSignalRebuild: boolean;
  effectiveSourcesChanged: boolean;
  isRetryDisabled: boolean;
  onRetry: () => void;
  backendSignalReady: boolean;
  isFullyUnlocked: boolean;
}) {
  const showSuccessTone = isFullyUnlocked;
  const displayProgress = progress;

  const label =
    status === "error"
      ? "We couldn’t finish this build"
      : needSignalRebuild && effectiveSourcesChanged
        ? "Rebuilding your Signal with fresh source data"
        : stage === "waiting_for_connected_sources"
          ? "Waiting for connected campaign sources"
          : stage === "awaiting_rebuild"
            ? "Rebuilding your Signal with fresh source data"
            : stage === "encoding_signal" || stage === "encoding_context"
              ? "Structuring your campaign data into intelligence"
              : isFullyUnlocked
                ? "Signal structured and ready"
                : "Structuring your campaign data into intelligence";

  const hint =
    status === "error"
      ? error || "Something interrupted the Signal generation flow. Retry to continue."
      : needSignalRebuild && effectiveSourcesChanged
        ? "We detected a change in your connected sources. We’re rebuilding the Signal so the export matches your latest data."
        : stage === "waiting_for_connected_sources"
          ? pendingConnectedSources.length > 0
            ? `We’re waiting for the remaining connected sources to finish syncing: ${pendingConnectedSources
                .map(humanizeSourceKey)
                .join(", ")}.`
            : "We’re waiting for your remaining connected sources to finish syncing before generating the final Signal."
          : stage === "encoding_signal" || stage === "encoding_context"
            ? "We’re generating the final Signal that powers your export."
            : isFullyUnlocked
              ? "Your Signal is complete. You can now generate the PDF export in the next step."
              : "We’re collecting, compacting and encoding your connected marketing sources into one Signal.";

  const wrapperTone = showSuccessTone
    ? "border-[#4FE3C1]/20 bg-[linear-gradient(180deg,rgba(79,227,193,0.08),rgba(255,255,255,0.03))]"
    : "border-white/10 bg-white/[0.03]";

  const badgeTone = showSuccessTone
    ? "border-[#4FE3C1]/22 bg-[#4FE3C1]/10 text-[#CFFFF0]"
    : "border-[#B55CFF]/18 bg-[#B55CFF]/10 text-[#E7D3FF]";

  const panelTone = showSuccessTone
    ? "border-[#4FE3C1]/16 bg-[linear-gradient(180deg,rgba(9,10,13,0.78),rgba(9,10,13,0.9))]"
    : "border-white/10 bg-[#090A0D]/80";

  const progressBarTone = showSuccessTone
    ? "bg-[linear-gradient(90deg,#4FE3C1_0%,#7CF5D9_55%,#B9FFE9_100%)] shadow-[0_0_20px_rgba(79,227,193,0.35)]"
    : "bg-[linear-gradient(90deg,#B55CFF_0%,#D66BFF_55%,#4FE3C1_100%)] shadow-[0_0_20px_rgba(181,92,255,0.35)]";

  return (
    <div className="mt-6">
      <div
        className={`adray-border-flow relative overflow-hidden rounded-[30px] border p-5 sm:rounded-[32px] sm:p-6 ${wrapperTone}`}
      >
        <div className="absolute inset-0 pointer-events-none opacity-70">
          <div
            className={`absolute -top-20 left-0 h-56 w-56 rounded-full blur-3xl ${
              showSuccessTone ? "bg-[#4FE3C1]/14" : "bg-[#B55CFF]/14"
            }`}
          />
          <div
            className={`absolute -bottom-20 right-0 h-56 w-56 rounded-full blur-3xl ${
              showSuccessTone ? "bg-[#B8FFF0]/10" : "bg-[#4FE3C1]/10"
            }`}
          />
        </div>

        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${badgeTone}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                SIGNAL BUILDER
                {backendSignalReady ? (
                  <span className="ml-1 inline-flex h-2 w-2 rounded-full bg-[#4FE3C1]" />
                ) : null}
              </div>

              <div className="mt-4 text-xl font-bold text-white/95 sm:text-2xl">{label}</div>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-white/58">{hint}</p>
            </div>

            <div className="shrink-0 text-right">
              <div
                className={`text-3xl font-extrabold sm:text-4xl ${
                  showSuccessTone ? "text-[#CFFFF0]" : "text-white/95"
                }`}
              >
                {displayProgress}%
              </div>
              <div className="mt-1 text-xs text-white/45">
                {isFullyUnlocked ? "Ready for PDF" : "Signal in progress"}
              </div>
            </div>
          </div>

          <div className={`adray-progress-shell mt-5 rounded-[24px] border p-4 sm:p-5 ${panelTone}`}>
            <div className="h-3 w-full overflow-hidden rounded-full border border-white/10 bg-white/[0.05]">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ease-linear ${progressBarTone}`}
                style={{ width: `${displayProgress}%` }}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-white/58">
                {status === "error" ? (
                  <span className="inline-flex h-2 w-2 rounded-full bg-red-400" />
                ) : showSuccessTone ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#4FE3C1]" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#B55CFF]" />
                )}

                <span>
                  {status === "error"
                    ? "Build interrupted"
                    : isFullyUnlocked
                      ? "Signal complete"
                      : "Structuring data"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    showSuccessTone
                      ? "border-[#4FE3C1]/18 bg-[#4FE3C1]/10 text-[#CFFFF0]"
                      : "border-white/10 bg-white/[0.03] text-white/68"
                  }`}
                >
                  {isFullyUnlocked ? "ready for pdf" : "structuring data"}
                </span>

                {!backendSignalReady && pendingConnectedSources.length > 0 && status === "processing" ? (
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/68">
                    Waiting for {pendingConnectedSources.map(humanizeSourceKey).join(", ")}
                  </span>
                ) : null}

                {needSignalRebuild && effectiveSourcesChanged ? (
                  <span className="rounded-full border border-[#B55CFF]/20 bg-[#B55CFF]/10 px-2.5 py-1 text-[11px] text-[#E7D3FF]">
                    Source change detected
                  </span>
                ) : null}

                {status === "error" ? (
                  <Button
                    size="sm"
                    onClick={onRetry}
                    disabled={isRetryDisabled}
                    className="rounded-xl bg-[#B55CFF] text-white hover:bg-[#A64DFA] disabled:opacity-50"
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

function WhileYouWaitCard() {
  return (
    <div className="adray-border-flow relative overflow-hidden rounded-[30px] border border-white/[0.10] bg-[linear-gradient(180deg,rgba(16,13,25,0.82)_0%,rgba(8,9,13,0.94)_100%)] p-5 sm:rounded-[32px] sm:p-6">
      <div className="absolute inset-0 pointer-events-none opacity-65">
        <div className="absolute -top-20 left-[10%] h-52 w-52 rounded-full blur-3xl bg-[#B55CFF]/12" />
        <div className="absolute -bottom-20 right-[8%] h-52 w-52 rounded-full blur-3xl bg-[#4FE3C1]/10" />
      </div>

      <div className="relative">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10.5px] uppercase tracking-[0.17em] text-white/70">
          <Sparkles className="h-3.5 w-3.5 text-[#D2A7FF]" />
          While you wait — how to use your Signal
        </div>

        <p className="mt-4 max-w-3xl text-sm leading-7 text-white/65 sm:text-[15px]">
          Your Signal becomes a PDF you can drop into any AI — Claude, ChatGPT, Gemini, Grok, or
          DeepSeek — to ask questions about performance in plain English. No integration work. Just
          attach and ask.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            "Download your Signal PDF when it’s ready",
            "Open any AI and attach the PDF to your conversation",
            "Ask about winners, budget shifts, losses, and next best actions",
          ].map((step, index) => (
            <div key={step} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 sm:p-4">
              <div className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#B55CFF]/30 bg-[#B55CFF]/15 text-[11px] font-semibold text-[#E7D3FF]">
                {index + 1}
              </div>
              <p className="mt-2 text-sm leading-6 text-white/72">{step}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function getPromptToneStyles(tone: PromptTone) {
  if (tone === "cyan") {
    return {
      ring: "border-[#7DE8FF]/16 hover:border-[#7DE8FF]/28",
      glowA: "bg-[#7DE8FF]/10",
      glowB: "bg-[#4FE3C1]/8",
      badge: "border-[#7DE8FF]/22 bg-[#7DE8FF]/10 text-[#D8F8FF]",
      dot: "bg-[#7DE8FF]",
      accentText: "text-[#D8F8FF]",
      softPanel: "bg-[linear-gradient(180deg,rgba(125,232,255,0.06),rgba(255,255,255,0.02))]",
      copyBtn: "border-[#7DE8FF]/20 bg-[#7DE8FF]/10 text-[#D8F8FF] hover:bg-[#7DE8FF]/14",
    };
  }

  if (tone === "emerald") {
    return {
      ring: "border-[#4FE3C1]/16 hover:border-[#4FE3C1]/28",
      glowA: "bg-[#4FE3C1]/10",
      glowB: "bg-[#B8FFF0]/8",
      badge: "border-[#4FE3C1]/22 bg-[#4FE3C1]/10 text-[#CFFFF0]",
      dot: "bg-[#4FE3C1]",
      accentText: "text-[#CFFFF0]",
      softPanel: "bg-[linear-gradient(180deg,rgba(79,227,193,0.06),rgba(255,255,255,0.02))]",
      copyBtn: "border-[#4FE3C1]/20 bg-[#4FE3C1]/10 text-[#CFFFF0] hover:bg-[#4FE3C1]/14",
    };
  }

  if (tone === "rose") {
    return {
      ring: "border-[#FF8FCB]/16 hover:border-[#FF8FCB]/28",
      glowA: "bg-[#FF8FCB]/10",
      glowB: "bg-[#FFB7D9]/8",
      badge: "border-[#FF8FCB]/22 bg-[#FF8FCB]/10 text-[#FFD8EA]",
      dot: "bg-[#FF8FCB]",
      accentText: "text-[#FFD8EA]",
      softPanel: "bg-[linear-gradient(180deg,rgba(255,143,203,0.06),rgba(255,255,255,0.02))]",
      copyBtn: "border-[#FF8FCB]/20 bg-[#FF8FCB]/10 text-[#FFD8EA] hover:bg-[#FF8FCB]/14",
    };
  }

  if (tone === "amber") {
    return {
      ring: "border-[#F5C26B]/16 hover:border-[#F5C26B]/28",
      glowA: "bg-[#F5C26B]/10",
      glowB: "bg-[#FFD897]/8",
      badge: "border-[#F5C26B]/22 bg-[#F5C26B]/10 text-[#FFE7BD]",
      dot: "bg-[#F5C26B]",
      accentText: "text-[#FFE7BD]",
      softPanel: "bg-[linear-gradient(180deg,rgba(245,194,107,0.06),rgba(255,255,255,0.02))]",
      copyBtn: "border-[#F5C26B]/20 bg-[#F5C26B]/10 text-[#FFE7BD] hover:bg-[#F5C26B]/14",
    };
  }

  return {
    ring: "border-[#B55CFF]/16 hover:border-[#B55CFF]/28",
    glowA: "bg-[#B55CFF]/10",
    glowB: "bg-[#D9C7FF]/8",
    badge: "border-[#B55CFF]/22 bg-[#B55CFF]/10 text-[#E7D3FF]",
    dot: "bg-[#B55CFF]",
    accentText: "text-[#E7D3FF]",
    softPanel: "bg-[linear-gradient(180deg,rgba(181,92,255,0.06),rgba(255,255,255,0.02))]",
    copyBtn: "border-[#B55CFF]/20 bg-[#B55CFF]/10 text-[#E7D3FF] hover:bg-[#B55CFF]/14",
  };
}

function SignalPromptAccordionCard({
  item,
  isOpen,
  isCopied,
  onToggle,
  onCopy,
}: {
  item: SignalPromptItem;
  isOpen: boolean;
  isCopied: boolean;
  onToggle: () => void;
  onCopy: (text: string, id: string) => void;
}) {
  const tone = getPromptToneStyles(item.tone);

  return (
    <div
      className={[
        "group relative overflow-hidden rounded-[28px] border bg-white/[0.02] transition-all duration-300",
        tone.ring,
        isOpen ? tone.softPanel : "hover:bg-white/[0.03]",
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className={["absolute -top-20 left-0 h-44 w-44 rounded-full blur-3xl", tone.glowA].join(" ")} />
        <div className={["absolute -bottom-20 right-0 h-44 w-44 rounded-full blur-3xl", tone.glowB].join(" ")} />
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="relative flex w-full items-start justify-between gap-4 px-4 py-4 text-left sm:px-5 sm:py-5"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10.5px] uppercase tracking-[0.18em] ${tone.badge}`}>
              <span className={["inline-flex h-2 w-2 rounded-full", tone.dot].join(" ")} />
              {item.eyebrow}
            </span>

            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10.5px] uppercase tracking-[0.16em] text-white/60">
              {item.audience}
            </span>
          </div>

          <h4 className="mt-3 text-lg font-semibold tracking-tight text-white/94 sm:text-[1.15rem]">
            {item.title}
          </h4>

          <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-white/54">{item.preview}</p>
        </div>

        <span
          className={`mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          <ChevronDown className={`h-4.5 w-4.5 ${tone.accentText}`} />
        </span>
      </button>

      <div
        className={`grid transition-all duration-300 ease-out ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="relative border-t border-white/10 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
            <div className="rounded-[22px] border border-white/10 bg-[#08090D]/88 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/42">Prompt body</p>
                  <p className="mt-1 text-sm text-white/60">Copy and paste this directly into your AI with the Signal PDF attached.</p>
                </div>

                <Button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopy(item.prompt, item.id);
                  }}
                  className={[
                    "h-10 rounded-xl border px-4 shadow-none",
                    tone.copyBtn,
                  ].join(" ")}
                >
                  {isCopied ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy prompt
                    </>
                  )}
                </Button>
              </div>

              <pre className="mt-4 whitespace-pre-wrap break-words rounded-[18px] border border-white/10 bg-white/[0.03] p-4 text-sm leading-7 text-white/78">
                {item.prompt}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalPromptsSection() {
  const [openId, setOpenId] = useState<string>(SIGNAL_PROMPTS[0]?.id || "");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const onCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1800);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <div className="adray-border-flow relative overflow-hidden rounded-[30px] border border-white/[0.10] bg-[linear-gradient(180deg,rgba(14,12,22,0.86)_0%,rgba(8,9,13,0.96)_100%)] p-5 sm:rounded-[32px] sm:p-6">
      <div className="absolute inset-0 pointer-events-none opacity-75">
        <div className="absolute -top-16 right-[8%] h-56 w-56 rounded-full blur-3xl bg-[#B55CFF]/10" />
        <div className="absolute bottom-0 left-[5%] h-56 w-56 rounded-full blur-3xl bg-[#4FE3C1]/8" />
      </div>

      <div className="relative">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10.5px] uppercase tracking-[0.17em] text-white/70">
          <Bot className="h-3.5 w-3.5 text-[#BFD8FF]" />
          Ready-to-use AI prompts
        </div>

        <div className="mt-4 max-w-2xl">
  <h3 className="text-[1.8rem] font-semibold tracking-tight text-white/94 sm:text-[2.2rem]">
    Prompt Library
  </h3>
  <p className="mt-2 text-sm leading-6 text-white/58 sm:text-[15px]">
    Open, copy, and use with your Signal PDF.
  </p>
</div>

        <div className="mt-6 space-y-3">
          {SIGNAL_PROMPTS.map((item) => (
            <SignalPromptAccordionCard
              key={item.id}
              item={item}
              isOpen={openId === item.id}
              isCopied={copiedId === item.id}
              onToggle={() => setOpenId((current) => (current === item.id ? "" : item.id))}
              onCopy={onCopy}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PdfLaunchCard({
  canGenerate,
  canDownload,
  signalStatus,
  pdfStatus,
  pdfFileName,
  pdfMeta,
  pdfError,
  isSubmitting,
  onGenerate,
  onDownload,
}: {
  canGenerate: boolean;
  canDownload: boolean;
  signalStatus: RuntimeSignalStatus;
  pdfStatus: "idle" | "processing" | "ready" | "failed";
  pdfFileName: string | null;
  pdfMeta: string | null;
  pdfError: string | null;
  isSubmitting: boolean;
  onGenerate: () => void;
  onDownload: () => void;
}) {
  const isGenerating = pdfStatus === "processing";
  const isReady = pdfStatus === "ready";
  const isFailed = pdfStatus === "failed";
  const rebuildingSignal = signalStatus === "stale";
  const canStart = canGenerate && !isSubmitting && (pdfStatus === "idle" || pdfStatus === "failed");
  const canStartDownload = canDownload && isReady;

  const title = canStartDownload
    ? "Your PDF is ready"
    : isGenerating
      ? "Generating your Signal PDF"
      : rebuildingSignal
        ? "Rebuilding Signal before PDF"
        : canGenerate
          ? "Generate your Signal PDF"
          : isFailed
            ? "PDF generation failed"
            : "Waiting for Signal";

  const description = canStartDownload
    ? pdfFileName || "Download your Signal PDF export."
    : isGenerating
      ? "We’re generating the PDF now. This usually takes a few seconds."
      : rebuildingSignal
        ? "Your sources changed and the backend is rebuilding Signal before allowing PDF generation."
        : canGenerate
          ? pdfError
            ? `Last PDF attempt failed: ${pdfError}`
            : "Generate a fresh PDF export for the latest Signal."
          : isFailed
            ? `Last PDF attempt failed${pdfError ? `: ${pdfError}` : "."}`
            : "The PDF button will unlock once the build is fully completed.";

  return (
    <div className="adray-border-flow relative overflow-hidden rounded-[30px] border border-white/[0.10] bg-[linear-gradient(180deg,rgba(18,14,28,0.84)_0%,rgba(9,10,13,0.95)_100%)] p-5 sm:rounded-[32px] sm:p-6">
      <div className="absolute inset-0 pointer-events-none opacity-70">
        <div className="absolute -top-20 right-0 h-56 w-56 rounded-full blur-3xl bg-[#4FE3C1]/12" />
        <div className="absolute -bottom-20 left-0 h-56 w-56 rounded-full blur-3xl bg-[#B55CFF]/14" />
      </div>

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#4FE3C1]/18 bg-[#4FE3C1]/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#CFFFF0]">
            <FileText className="h-3.5 w-3.5" />
            Your Signal PDF
          </div>

          <h2 className="mt-4 text-2xl font-bold tracking-tight text-white/95 sm:text-3xl">{title}</h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-white/56 sm:text-base">{description}</p>
        </div>

        <div className="w-full lg:w-auto">
          <div className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,9,14,0.9)_0%,rgba(7,8,12,0.98)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-5 lg:min-w-[360px]">
            <div className="flex items-center gap-3">
              <span
                className={[
                  "inline-flex h-11 w-11 items-center justify-center rounded-2xl border",
                  canStartDownload
                    ? "border-[#4FE3C1]/25 bg-[#4FE3C1]/10"
                    : canGenerate || isFailed
                      ? "border-[#B55CFF]/25 bg-[#B55CFF]/10"
                      : "border-white/10 bg-white/[0.04]",
                ].join(" ")}
              >
                {canStartDownload ? (
                  <FileText className="h-5 w-5 text-[#4FE3C1]" />
                ) : isGenerating ? (
                  <Loader2 className="h-5 w-5 animate-spin text-[#B55CFF]" />
                ) : canGenerate || isFailed ? (
                  <Sparkles className="h-5 w-5 text-[#D2A7FF]" />
                ) : (
                  <LockKeyhole className="h-5 w-5 text-white/55" />
                )}
              </span>

              <div className="min-w-0">
                <p className="text-sm font-semibold text-white/92">
                  {canStartDownload
                    ? "Download PDF"
                    : isGenerating
                      ? "Generating PDF"
                      : rebuildingSignal
                        ? "Rebuilding Signal"
                        : canGenerate
                          ? "Generate PDF"
                          : isFailed
                            ? "Retry PDF"
                            : "Waiting for Signal"}
                </p>
                <p className="mt-1 break-words text-xs text-white/48">
                  {canStartDownload ? (pdfFileName || "Signal export ready") : description}
                </p>
                {canStartDownload && pdfMeta ? (
                  <p className="mt-1 text-[11px] text-white/38">{pdfMeta}</p>
                ) : null}
              </div>
            </div>

            {canStartDownload ? (
              <Button
                onClick={onDownload}
                className="mt-5 h-12 w-full rounded-2xl bg-gradient-to-r from-[#A64DFA] via-[#B55CFF] to-[#C16BFF] px-5 text-white hover:from-[#9B43F0] hover:via-[#A64DFA] hover:to-[#B95DFF] shadow-[0_0_30px_rgba(181,92,255,0.34)]"
              >
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </Button>
            ) : canStart ? (
              <Button
                onClick={onGenerate}
                className="mt-5 h-12 w-full rounded-2xl bg-gradient-to-r from-[#A64DFA] via-[#B55CFF] to-[#C16BFF] px-5 text-white hover:from-[#9B43F0] hover:via-[#A64DFA] hover:to-[#B95DFF] shadow-[0_0_30px_rgba(181,92,255,0.34)]"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {pdfStatus === "failed" ? "Retry PDF generation" : "Generate PDF"}
              </Button>
            ) : (
              <Button
                disabled
                className="mt-5 h-12 w-full rounded-2xl bg-white/[0.06] px-5 text-white/55 hover:bg-white/[0.06]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting PDF
                  </>
                ) : isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating PDF
                  </>
                ) : rebuildingSignal ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Rebuilding Signal
                  </>
                ) : (
                  <>
                    <LockKeyhole className="mr-2 h-4 w-4" />
                    Waiting for Signal
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelCompatibilityCard({
  logoSrc,
  title,
  accent,
}: {
  logoSrc: string;
  title: string;
  accent: "purple" | "emerald" | "blue" | "silver";
}) {
  const theme =
    accent === "emerald"
      ? {
          border: "border-[#4FE3C1]/14",
          hover: "hover:border-[#4FE3C1]/28",
          glowA: "bg-[#4FE3C1]/12",
          glowB: "bg-[#4FE3C1]/10",
          dot: "bg-[#4FE3C1]",
        }
      : accent === "blue"
        ? {
            border: "border-[#A7D6FF]/14",
            hover: "hover:border-[#A7D6FF]/28",
            glowA: "bg-[#A7D6FF]/12",
            glowB: "bg-[#A7D6FF]/10",
            dot: "bg-[#A7D6FF]",
          }
        : accent === "silver"
          ? {
              border: "border-white/12",
              hover: "hover:border-white/24",
              glowA: "bg-white/[0.08]",
              glowB: "bg-white/[0.06]",
              dot: "bg-white/70",
            }
          : {
              border: "border-[#D9C7FF]/14",
              hover: "hover:border-[#D9C7FF]/28",
              glowA: "bg-[#D9C7FF]/12",
              glowB: "bg-[#D9C7FF]/10",
              dot: "bg-[#D9C7FF]",
            };

  return (
    <div
      className={[
        "group relative overflow-hidden rounded-[30px] border bg-white/[0.018] transition-all duration-300",
        "min-h-[250px] sm:min-h-[280px] xl:min-h-[310px]",
        theme.border,
        theme.hover,
        "hover:bg-white/[0.03]",
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className={["absolute -bottom-24 -left-12 h-48 w-48 rounded-full blur-3xl", theme.glowA].join(" ")} />
        <div className={["absolute -top-24 right-0 h-48 w-48 rounded-full blur-3xl", theme.glowB].join(" ")} />
      </div>

      <div className="relative flex h-full items-center justify-center px-8 py-8 sm:px-10 sm:py-10">
        <div className="absolute right-5 top-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-white/78 backdrop-blur-md">
          <span className={["inline-block h-2 w-2 rounded-full", theme.dot].join(" ")} />
          Compatible
        </div>

        <img
          src={logoSrc}
          alt={title}
          className="max-h-[170px] w-auto max-w-[90%] object-contain opacity-95 transition-transform duration-300 group-hover:scale-[1.03] sm:max-h-[210px] xl:max-h-[250px]"
          draggable={false}
        />
      </div>
    </div>
  );
}

export default function LastStep() {
  const nav = useNavigate();

  const [statusHydrated, setStatusHydrated] = useState(false);
  const [state, setState] = useState<CanonicalUiState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isGeneratingPdfIntent, setIsGeneratingPdfIntent] = useState(false);
  const [visualProgress, setVisualProgress] = useState(0);
  const [skipInitialSignalReplay, setSkipInitialSignalReplay] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const pollingTimeoutRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const requestInFlightRef = useRef(false);
  const requestSeqRef = useRef(0);
  const latestAppliedSeqRef = useRef(0);

  const bootHasTriggeredBuildRef = useRef(false);
  const manualBuildInFlightRef = useRef(false);
  const manualPdfInFlightRef = useRef(false);
  const dailyDeliveryActivateInFlightRef = useRef(false);

  const lastKnownFingerprintRef = useRef<string | null>(null);
  const sourceChangeObservedRef = useRef(false);

  const supportedModels: SupportedModel[] = [
    { key: "chatgpt", title: "ChatGPT", logoSrc: chatgptLogo, accent: "emerald" },
    { key: "claude", title: "Claude", logoSrc: claudeLogo, accent: "purple" },
    { key: "gemini", title: "Gemini", logoSrc: geminiLogo, accent: "blue" },
    { key: "grok", title: "Grok", logoSrc: grokLogo, accent: "silver" },
    { key: "deepseek", title: "DeepSeek", logoSrc: deepseekLogo, accent: "blue" },
    { key: "copilot", title: "Copilot", logoSrc: copilotLogo, accent: "blue" },
  ];

  const showToast = (text: string) => {
    setToast(text);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1800);
  };

  const applyStatus = (payload?: ContextStatusData, options?: { force?: boolean; seq?: number }) => {
    if (!payload) return null;

    const seq = options?.seq ?? 0;
    const next = deriveCanonicalStateFromStatus(payload);
    const signalAlreadyReadyOnHydration =
      next.signalStatus === "ready" &&
      !next.needSignalRebuild &&
      (next.signalReadyForPdf || next.signalComplete);

    let accepted: CanonicalUiState | null = null;

    setState((prev) => {
      if (!options?.force && seq < latestAppliedSeqRef.current && prev) {
        return prev;
      }

      latestAppliedSeqRef.current = Math.max(latestAppliedSeqRef.current, seq);
      accepted = next;
      return next;
    });

    setStatusHydrated(true);

    if (!statusHydrated) {
      setSkipInitialSignalReplay(signalAlreadyReadyOnHydration);

      if (signalAlreadyReadyOnHydration) {
        clearStoredSignalGate();
        setVisualProgress(100);
      }
    }

    if (next.currentSourceFingerprint) {
      if (
        lastKnownFingerprintRef.current &&
        lastKnownFingerprintRef.current !== next.currentSourceFingerprint
      ) {
        sourceChangeObservedRef.current = true;
      }
      lastKnownFingerprintRef.current = next.currentSourceFingerprint;
    }

    if (next.signalStatus === "ready" || next.pdfStatus === "ready") {
      sourceChangeObservedRef.current = false;
    }

    if (next.pdfStatus === "ready" || next.pdfStatus === "failed") {
      setIsGeneratingPdfIntent(false);
      manualPdfInFlightRef.current = false;
    }

    if (
      next.signalStatus === "processing" ||
      next.signalStatus === "ready" ||
      next.signalStatus === "stale"
    ) {
      bootHasTriggeredBuildRef.current = true;
    }

    return accepted || next;
  };

  const stopPolling = () => {
    if (pollingTimeoutRef.current) {
      window.clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  };

  const fetchStatus = async (options?: { force?: boolean }) => {
    const seq = ++requestSeqRef.current;
    const json = await apiJson<ContextStatusResponse>("/api/mcp/context/status");
    return applyStatus(json?.data, { force: options?.force, seq });
  };

  const buildContext = async (forceRebuild = false) => {
    if (manualBuildInFlightRef.current) {
      return null;
    }

    manualBuildInFlightRef.current = true;

    try {
      const seq = ++requestSeqRef.current;
      const json = await apiJson<ContextStatusResponse>("/api/mcp/context/build", {
        method: "POST",
        body: JSON.stringify({ forceRebuild }),
      });
      return applyStatus(json?.data, { force: true, seq });
    } finally {
      manualBuildInFlightRef.current = false;
    }
  };

  const buildPdf = async (forceRebuild = false) => {
    if (manualPdfInFlightRef.current) {
      return null;
    }

    manualPdfInFlightRef.current = true;

    try {
      const seq = ++requestSeqRef.current;
      const json = await apiJson<ContextStatusResponse>("/api/mcp/context/pdf/build", {
        method: "POST",
        body: JSON.stringify({ forceRebuild }),
      });
      return applyStatus(json?.data, { force: true, seq });
    } finally {
      manualPdfInFlightRef.current = false;
    }
  };

  const activateDailyDeliveryOnGeneratePdf = async () => {
    if (dailyDeliveryActivateInFlightRef.current) return;

    dailyDeliveryActivateInFlightRef.current = true;

    try {
      await apiJson("/api/daily-signal-delivery/activate", {
        method: "POST",
        body: JSON.stringify({
          trigger: "generate_pdf_click",
        }),
      });
    } catch (err) {
      console.error("[LastStep] daily delivery activate warning:", err);
    } finally {
      dailyDeliveryActivateInFlightRef.current = false;
    }
  };

  const shouldKeepPolling = (s: CanonicalUiState | null) => {
    if (!s) return true;
    return !!s.shouldPoll;
  };

  const getNextPollDelay = (s: CanonicalUiState | null) => {
    if (!s) return 1500;
    return s.pollIntervalMs || 1800;
  };

  const schedulePoll = (delay?: number) => {
    stopPolling();

    const effectiveDelay = typeof delay === "number" ? delay : getNextPollDelay(state);

    pollingTimeoutRef.current = window.setTimeout(async () => {
      if (!mountedRef.current) return;

      if (requestInFlightRef.current) {
        schedulePoll(900);
        return;
      }

      requestInFlightRef.current = true;

      try {
        const next = await fetchStatus();
        if (shouldKeepPolling(next)) {
          schedulePoll(getNextPollDelay(next));
          return;
        }
        stopPolling();
      } catch {
        schedulePoll(2200);
      } finally {
        requestInFlightRef.current = false;
      }
    }, effectiveDelay);
  };

  const hardRefreshStatus = async () => {
    if (!mountedRef.current) return null;
    if (requestInFlightRef.current) return null;

    requestInFlightRef.current = true;
    try {
      const next = await fetchStatus({ force: true });
      if (shouldKeepPolling(next)) {
        schedulePoll(getNextPollDelay(next));
      } else {
        stopPolling();
      }
      return next;
    } catch {
      schedulePoll(1800);
      return null;
    } finally {
      requestInFlightRef.current = false;
    }
  };

  const maybeStartInitialBuild = async (current: CanonicalUiState | null) => {
    if (!mountedRef.current) return;

    if (bootHasTriggeredBuildRef.current) {
      if (shouldKeepPolling(current)) schedulePoll(getNextPollDelay(current));
      return;
    }

    if (!current) {
      bootHasTriggeredBuildRef.current = true;
      const built = await buildContext(false);
      if (shouldKeepPolling(built)) schedulePoll(getNextPollDelay(built));
      return;
    }

    if (current.signalStatus === "idle" && current.connectedSources.length > 0) {
      bootHasTriggeredBuildRef.current = true;
      const built = await buildContext(false);
      if (shouldKeepPolling(built)) schedulePoll(getNextPollDelay(built));
      return;
    }

    if (current.signalStatus === "stale") {
      bootHasTriggeredBuildRef.current = true;
      const rebuilt = await buildContext(true);
      if (shouldKeepPolling(rebuilt)) schedulePoll(getNextPollDelay(rebuilt));
      return;
    }

    if (shouldKeepPolling(current)) {
      schedulePoll(getNextPollDelay(current));
    } else {
      stopPolling();
    }
  };

  useEffect(() => {
    mountedRef.current = true;

    const boot = async () => {
      try {
        const current = await fetchStatus({ force: true });
        if (!mountedRef.current) return;
        await maybeStartInitialBuild(current);
      } catch {
        if (!mountedRef.current) return;
        setStatusHydrated(true);
        await maybeStartInitialBuild(null);
      }
    };

    boot();

    return () => {
      mountedRef.current = false;
      stopPolling();
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onFocus = () => {
      hardRefreshStatus();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        hardRefreshStatus();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    const onPossibleSourceChange = () => {
      sourceChangeObservedRef.current = true;
      hardRefreshStatus();
    };

    window.addEventListener("storage", onPossibleSourceChange);
    window.addEventListener("accounts-selection-saved", onPossibleSourceChange as EventListener);
    window.addEventListener("adray:accounts-selection-saved", onPossibleSourceChange as EventListener);
    window.addEventListener("not-needed", onPossibleSourceChange as EventListener);
    window.addEventListener("adray:pixels-selection-saved", onPossibleSourceChange as EventListener);
    window.addEventListener("onboarding-flow-completed", onPossibleSourceChange as EventListener);

    return () => {
      window.removeEventListener("storage", onPossibleSourceChange);
      window.removeEventListener("accounts-selection-saved", onPossibleSourceChange as EventListener);
      window.removeEventListener("adray:accounts-selection-saved", onPossibleSourceChange as EventListener);
      window.removeEventListener("not-needed", onPossibleSourceChange as EventListener);
      window.removeEventListener("adray:pixels-selection-saved", onPossibleSourceChange as EventListener);
      window.removeEventListener("onboarding-flow-completed", onPossibleSourceChange as EventListener);
    };
  }, []);

  const connectedSourcesKey = useMemo(() => {
    if (!state?.connectedSources?.length) return "";
    return [...state.connectedSources].sort().join("|");
  }, [state?.connectedSources]);

  const storedGate = useMemo(() => {
    if (!connectedSourcesKey) return null;
    const stored = readStoredSignalGate();
    if (!stored || stored.sourceKey !== connectedSourcesKey) return null;
    return stored;
  }, [connectedSourcesKey, nowMs]);

  const elapsedMs = useMemo(() => {
    if (!storedGate) return 0;
    return Math.max(0, nowMs - storedGate.startedAt);
  }, [storedGate, nowMs]);

  const backendSignalReady = !!state && state.signalStatus === "ready";
  const bypassVisualGate =
    skipInitialSignalReplay &&
    !!state &&
    state.signalStatus === "ready" &&
    !state.needSignalRebuild &&
    (state.signalReadyForPdf || state.signalComplete);
  // If this is a rebuild (signal existed before, needSignalRebuild was true),
  // use a shorter minimum gate so user doesn't wait 3.5min again.
  const isSignalRebuild = !!state?.needSignalRebuild || state?.signalStatus === 'stale';
  const effectiveGateMs = isSignalRebuild ? MOCK_SIGNAL_REBUILD_DURATION_MS : MOCK_SIGNAL_MIN_DURATION_MS;
  const gateMinDurationElapsed = elapsedMs >= effectiveGateMs;

  useEffect(() => {
    if (!skipInitialSignalReplay || !state) return;

    if (
      state.signalStatus !== "ready" ||
      state.signalStatus === "stale" ||
      state.needSignalRebuild ||
      (!state.signalReadyForPdf && !state.signalComplete)
    ) {
      setSkipInitialSignalReplay(false);
    }
  }, [
    skipInitialSignalReplay,
    state?.signalStatus,
    state?.needSignalRebuild,
    state?.signalReadyForPdf,
    state?.signalComplete,
  ]);

  useEffect(() => {
    if (!statusHydrated) return;

    if (!connectedSourcesKey) {
      clearStoredSignalGate();
      setVisualProgress(0);
      return;
    }

    if (bypassVisualGate) {
      clearStoredSignalGate();
      setVisualProgress(100);
      return;
    }

    const stored = readStoredSignalGate();

    if (!stored || stored.sourceKey !== connectedSourcesKey) {
      const nextGate: StoredSignalGate = {
        sourceKey: connectedSourcesKey,
        startedAt: Date.now(),
      };
      writeStoredSignalGate(nextGate);
      setNowMs(nextGate.startedAt);
      // Do NOT reset progress to 0 — keep current progress as floor to avoid
      // jarring backward jump when a new source is detected mid-build.
      // Progress will smoothly continue from current position.
      setVisualProgress((prev) => Math.max(prev > 0 ? 5 : 0, 0));
      return;
    }

    setNowMs(Date.now());
  }, [statusHydrated, connectedSourcesKey, bypassVisualGate]);

  useEffect(() => {
    if (!connectedSourcesKey || bypassVisualGate) return;

    const tick = () => setNowMs(Date.now());
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [connectedSourcesKey, bypassVisualGate]);

  useEffect(() => {
    if (bypassVisualGate) {
      setVisualProgress(100);
      return;
    }

    if (!connectedSourcesKey || !storedGate) return;

    let targetProgress: number;

    if (backendSignalReady && gateMinDurationElapsed) {
      targetProgress = 100;
    } else {
      // Blend time-based progress with backend-reported progress (if available)
      const timeBasedProgress = computeSmoothProgress(elapsedMs, VISUAL_PROGRESS_CAP_BEFORE_READY);
      const backendProgress = typeof state?.signalProgress === 'number'
        ? Math.min(state.signalProgress, VISUAL_PROGRESS_CAP_BEFORE_READY)
        : 0;
      // Use max of time-based and backend-reported so it never goes backward
      targetProgress = Math.max(timeBasedProgress, backendProgress);
    }

    setVisualProgress((prev) => Math.max(prev, targetProgress));
  }, [connectedSourcesKey, storedGate, elapsedMs, backendSignalReady, gateMinDurationElapsed, bypassVisualGate, state?.signalProgress]);

  const isFullyUnlocked = bypassVisualGate || (gateMinDurationElapsed && backendSignalReady);

  const signalIsStaleOrRebuilding =
    state?.needSignalRebuild === true ||
    state?.signalStatus === 'stale' ||
    state?.signalStatus === 'processing';

  const effectiveCanGeneratePdf =
    !!state?.canGeneratePdf &&
    isFullyUnlocked &&
    !signalIsStaleOrRebuilding;

  const effectiveCanDownloadPdf =
    !!state?.canDownloadPdf &&
    isFullyUnlocked &&
    !signalIsStaleOrRebuilding;

  const onRetrySignal = async () => {
    if (!state) return;
    if (state.signalStatus === "processing" || isGeneratingPdfIntent || state.pdfStatus === "processing") return;

    latestAppliedSeqRef.current = 0;
    requestSeqRef.current = 0;
    bootHasTriggeredBuildRef.current = false;
    manualBuildInFlightRef.current = false;
    manualPdfInFlightRef.current = false;
    sourceChangeObservedRef.current = false;

    clearStoredSignalGate();
    setVisualProgress(0);
    setSkipInitialSignalReplay(false);
    setNowMs(Date.now());

    setState((prev) =>
      prev
        ? {
            ...prev,
            buildStatus: "idle",
            buildStage: "idle",
            buildError: null,
            serverProgress: 0,
            signalStatus: "idle",
            signalReadyForPdf: false,
            signalComplete: false,
            needSignalRebuild: false,
            pdfStatus: "idle",
            pdfReady: false,
            pdfProcessing: false,
            pdfFailed: false,
            needPdfRebuild: false,
            canGeneratePdf: false,
            canDownloadPdf: false,
            heroChipText: "Preparing your Signal",
            uiTitle: "Preparing your Signal",
            uiDescription: "We’re restarting the Signal build.",
            tipText: "Retrying the Signal build from backend.",
          }
        : prev
    );

    setIsGeneratingPdfIntent(false);
    stopPolling();

    bootHasTriggeredBuildRef.current = true;
    const built = await buildContext(true);
    if (shouldKeepPolling(built)) schedulePoll(getNextPollDelay(built));
  };

  const onGeneratePdf = async () => {
    if (!state) return;
    if (!effectiveCanGeneratePdf) return;
    if (state.signalStatus !== "ready") return;
    if (isGeneratingPdfIntent || state.pdfStatus === "processing" || manualPdfInFlightRef.current) return;

    try {
      setIsGeneratingPdfIntent(true);

      await activateDailyDeliveryOnGeneratePdf();

      const result = await buildPdf(state.pdfStatus === "failed");

      if (!result) {
        schedulePoll();
        return;
      }

      if (result.pdfStatus === "ready") {
        setIsGeneratingPdfIntent(false);
        manualPdfInFlightRef.current = false;
        showToast("Your PDF is ready");
        schedulePoll(getNextPollDelay(result));
        return;
      }

      if (result.pdfStatus === "processing" || result.shouldPoll) {
        schedulePoll(getNextPollDelay(result));
        return;
      }

      if (result.signalStatus === "stale" || result.signalStatus === "processing") {
        setIsGeneratingPdfIntent(false);
        manualPdfInFlightRef.current = false;
        showToast("Signal must be ready before generating the PDF");
        schedulePoll(getNextPollDelay(result));
        return;
      }

      if (result.pdfStatus === "failed") {
        setIsGeneratingPdfIntent(false);
        manualPdfInFlightRef.current = false;
        showToast("PDF generation failed. Please retry.");
        schedulePoll(getNextPollDelay(result));
        return;
      }

      const fresh = await fetchStatus({ force: true });
      setIsGeneratingPdfIntent(false);
      manualPdfInFlightRef.current = false;
      schedulePoll(getNextPollDelay(fresh || state));
    } catch (err: any) {
      setIsGeneratingPdfIntent(false);
      manualPdfInFlightRef.current = false;
      setState((prev) =>
        prev
          ? {
              ...prev,
              pdfStatus: "failed",
              pdfProcessing: false,
              pdfFailed: true,
              canGeneratePdf: prev.signalStatus === "ready",
              canDownloadPdf: false,
              pdfError: err?.message || "Failed to build PDF",
              tipText: err?.message || "Failed to build PDF",
            }
          : prev
      );
      schedulePoll(1800);
    }
  };

  const onDownloadPdf = () => {
    if (!state) return;
    if (!effectiveCanDownloadPdf) return;

    const url = state.pdfDownloadUrl || "/api/mcp/context/pdf/download";
    window.open(url, "_blank", "noopener,noreferrer");
    showToast("Your PDF download has started");
    schedulePoll(getNextPollDelay(state));
  };

  const displayPdfStatus: "idle" | "processing" | "ready" | "failed" = useMemo(() => {
    if (!state) return "idle";
    if (state.pdfStatus === "ready") return "ready";
    if (state.pdfStatus === "processing") return "processing";
    if (state.pdfStatus === "failed") return "failed";
    return "idle";
  }, [state]);

  const isProcessingSignal = !!state && state.signalStatus === "processing";

  const effectiveHeroChipText = isFullyUnlocked
    ? state?.heroChipText || "Your Signal is ready"
    : "Preparing your Signal";
  const effectiveHeroTitle = isFullyUnlocked
    ? state?.uiTitle || "Your Signal is ready"
    : "Your data is being turned into intelligence";
  const effectiveHeroDescription = isFullyUnlocked
    ? state?.uiDescription || "Your previous PDF is outdated for the current Signal. Generate a fresh PDF."
    : "We’re collecting, compacting and encoding your connected marketing sources into one Signal.";

  const effectiveTipText = isFullyUnlocked
    ? state?.tipText || "Your Signal is ready for PDF generation."
    : gateMinDurationElapsed && !backendSignalReady
      ? "The visual build is complete. We’re still waiting for the backend to confirm the final Signal state."
      : "We’re aligning the final Signal build before unlocking the PDF action.";

  return (
    <DashboardLayout>
      <div className="min-h-screen overflow-x-hidden bg-[#050507]">
        <div className="overflow-x-hidden p-2.5 sm:p-6">
          <Card className="glass-effect mx-auto w-full max-w-full overflow-hidden rounded-[30px] border border-white/[0.06] bg-[#0F1012] shadow-[0_20px_80px_rgba(0,0,0,0.45)] sm:rounded-[34px]">
            <div className="relative">
              <div className="pointer-events-none absolute inset-0 opacity-70">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#B55CFF]/35 to-transparent" />
                <div className="absolute -top-20 left-[8%] h-72 w-72 rounded-full bg-[#B55CFF]/10 blur-3xl" />
                <div className="absolute top-[22%] right-[4%] h-72 w-72 rounded-full bg-[#4FE3C1]/8 blur-3xl" />
                <div className="absolute bottom-0 left-1/2 h-60 w-[44rem] -translate-x-1/2 rounded-full bg-[#B55CFF]/8 blur-3xl" />
              </div>

              <CardContent className="relative min-w-0 max-w-full p-2.5 sm:p-6">
                <div className="adray-dashboard-shell relative min-w-0 max-w-full overflow-x-hidden">
                  <div className="adray-hero-bg relative min-w-0 max-w-full overflow-hidden rounded-[30px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.94)_0%,rgba(10,10,14,0.98)_100%)] p-4 sm:rounded-[36px] sm:p-8">
                    <div className="adray-hero-grid" />
                    <div className="adray-hero-beam" />

                    <span className="adray-particle left-[12%] top-[16%]" style={{ animationDelay: "0s" }} />
                    <span className="adray-particle left-[18%] top-[70%]" style={{ animationDelay: ".8s" }} />
                    <span className="adray-particle left-[62%] top-[22%]" style={{ animationDelay: "1.4s" }} />
                    <span className="adray-particle left-[74%] top-[62%]" style={{ animationDelay: "2s" }} />
                    <span className="adray-particle left-[48%] top-[78%]" style={{ animationDelay: "2.8s" }} />

                    <div className="relative z-10">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <StepProgress step={2} />

                        <Button
                          variant="ghost"
                          onClick={() => nav("/")}
                          className="w-full justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white/85 hover:bg-white/[0.08] sm:w-auto sm:justify-start"
                        >
                          <ArrowLeft className="mr-2 h-4 w-4" />
                          Back
                        </Button>
                      </div>

                      <div className="mt-6 max-w-4xl">
                        <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#B55CFF]/20 bg-[#B55CFF]/10 px-3 py-1 text-[11px] text-[#E7D3FF] backdrop-blur-md">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{effectiveHeroChipText}</span>
                        </div>

                        <div className="mt-5 min-w-0">
                          <p className="text-[11px] uppercase tracking-[0.24em] text-white/38">
                            Final Step · Signal Intelligence
                          </p>

                          <h1 className="mt-3 max-w-[820px] text-[1.9rem] font-extrabold leading-[0.96] tracking-[-0.04em] text-white/95 sm:text-[3.65rem]">
                            {effectiveHeroTitle}
                          </h1>

                          <p className="mt-4 max-w-3xl text-[13px] leading-6 text-white/56 sm:text-[16px] sm:leading-7">
                            {effectiveHeroDescription}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <BuildProgressPanel
                  progress={visualProgress}
                  status={state?.buildStatus || "idle"}
                  stage={state?.buildStage || "idle"}
                  error={state?.buildError || null}
                  pendingConnectedSources={state?.pendingConnectedSources || []}
                  needSignalRebuild={state?.signalStatus === "stale"}
                  effectiveSourcesChanged={!!state?.runtime?.effectiveSources?.changedSinceLastSignal}
                  isRetryDisabled={isProcessingSignal || isGeneratingPdfIntent || displayPdfStatus === "processing"}
                  onRetry={onRetrySignal}
                  backendSignalReady={backendSignalReady}
                  isFullyUnlocked={isFullyUnlocked}
                />

                <div className="mt-6">
                  <PdfLaunchCard
                    canGenerate={effectiveCanGeneratePdf}
                    canDownload={effectiveCanDownloadPdf}
                    signalStatus={state?.signalStatus || "idle"}
                    pdfStatus={displayPdfStatus}
                    pdfFileName={state?.pdfFileName || null}
                    pdfMeta={state?.pdfMeta || null}
                    pdfError={state?.pdfError || null}
                    isSubmitting={isGeneratingPdfIntent && displayPdfStatus !== "processing"}
                    onGenerate={onGeneratePdf}
                    onDownload={onDownloadPdf}
                  />
                </div>

                <div className="mt-6">
                  <WhileYouWaitCard />
                </div>

                <div className="mt-6">
                  <SignalPromptsSection />
                </div>

                <div className="mt-6 rounded-[30px] border border-white/10 bg-white/[0.025] p-5 sm:p-6 xl:p-7">
                  <div className="max-w-3xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10.5px] uppercase tracking-[0.18em] text-white/62">
                      <Bot className="h-3.5 w-3.5" />
                      AI Compatibility
                    </div>

                    <h3 className="mt-4 text-[2rem] font-semibold tracking-tight text-white/94 sm:text-[2.35rem]">
                      Works with top AI models
                    </h3>
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-3">
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

                <div className="adray-laststep-tip mt-5 rounded-2xl border px-4 py-3 text-sm text-white/65">
                  Tip: {effectiveTipText}
                </div>

                {toast ? (
                  <div className="adray-laststep-toast fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
                    <div className="rounded-full border border-white/10 bg-black/75 px-4 py-2 text-xs text-white/92 shadow-[0_0_24px_rgba(181,92,255,0.18)] backdrop-blur-md">
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
