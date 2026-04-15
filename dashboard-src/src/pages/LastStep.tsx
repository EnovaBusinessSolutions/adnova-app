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
} from "lucide-react";

import chatgptLogo from "@/assets/logos/chatgpt.png";
import claudeLogo from "@/assets/logos/claude.png";
import geminiLogo from "@/assets/logos/gemini.png";
import grokLogo from "@/assets/logos/grock.png";
import deepseekLogo from "@/assets/logos/deepseek.png";
import copilotLogo from "@/assets/logos/Copilot.png";

type BuildStage =
  | "idle"
  | "waiting_for_sources"
  | "waiting_for_connected_sources"
  | "waiting_for_valid_signal"
  | "loading_sources"
  | "compacting_sources"
  | "compacting_partial_sources"
  | "encoding_signal"
  | "encoding_context"
  | "rendering_pdf"
  | "building_document"
  | "completed"
  | "completed_partial"
  | "failed"
  | "stabilizing"
  | "awaiting_rebuild";

type UiMode =
  | "signal_building"
  | "signal_not_ready"
  | "signal_rebuild_required"
  | "signal_ready"
  | "pdf_rebuild_required"
  | "pdf_building"
  | "pdf_failed"
  | "pdf_ready";

type PdfBuildState =
  | "idle"
  | "signal_not_ready"
  | "signal_rebuild_required"
  | "pdf_rebuild_required"
  | "pdf_processing"
  | "pdf_ready"
  | "pdf_failed";

type PdfStatus = {
  status?: "idle" | "processing" | "ready" | "failed";
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
  sourceFingerprint?: string | null;
  connectionFingerprint?: string | null;
  stale?: boolean;
  staleReason?: string | null;
};

type ContextStatusData = {
  status?: "idle" | "processing" | "done" | "error";
  progress?: number;
  stage?: BuildStage | string;
  startedAt?: string | null;
  finishedAt?: string | null;
  snapshotId?: string | null;

  hasEncodedPayload?: boolean;
  hasSignal?: boolean;
  signalReady?: boolean;
  signalComplete?: boolean;
  signalValidForPdf?: boolean;
  signalReadyForPdf?: boolean;
  signalRunId?: string | null;

  hasPdf?: boolean;
  pdfReady?: boolean;
  pdfProcessing?: boolean;
  pdfFailed?: boolean;
  canGeneratePdf?: boolean;
  canDownloadPdf?: boolean;
  uiMode?: UiMode | string;
  pdfBuildState?: PdfBuildState | string;

  providerAgnostic?: boolean;
  usedOpenAI?: boolean;
  model?: string | null;
  error?: string | null;
  buildAttemptId?: string | null;

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
  needsSignalRebuild?: boolean;
  needPdfRebuild?: boolean;
  needsPdfRebuild?: boolean;
  effectiveSourcesChanged?: boolean;

  pdf?: PdfStatus;
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
  buildStatus: "idle" | "processing" | "done" | "error";
  buildStage: string;
  serverProgress: number;
  startedAt: string | null;
  finishedAt: string | null;
  buildAttemptId: string | null;
  signalRunId: string | null;

  hasEncodedPayload: boolean;
  hasSignal: boolean;
  signalComplete: boolean;
  signalValidForPdf: boolean;
  signalReadyForPdf: boolean;
  hasPdf: boolean;

  pdfReady: boolean;
  pdfProcessing: boolean;
  pdfFailed: boolean;
  canGeneratePdf: boolean;
  canDownloadPdf: boolean;
  uiMode: UiMode;
  pdfBuildState: PdfBuildState;

  connectedSources: string[];
  usableSources: string[];
  pendingConnectedSources: string[];
  failedSources: string[];

  pdfStatus: "idle" | "processing" | "ready" | "failed";
  pdfStage: string;
  pdfDownloadUrl: string | null;
  pdfFileName: string | null;
  pdfError: string | null;
  pdfMeta: string | null;

  usedOpenAI: boolean;
  model: string | null;
  buildError: string | null;

  snapshotId: string | null;
  sourceFingerprint: string | null;
  currentSourceFingerprint: string | null;
  currentSourcesSnapshot: Record<string, any> | null;
  connectionFingerprint: string | null;

  staleSignal: boolean;
  stalePdf: boolean;
  needSignalRebuild: boolean;
  needPdfRebuild: boolean;
  effectiveSourcesChanged: boolean;
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

function parseMaybeDate(input?: string | null) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function msSince(input?: string | null) {
  const d = parseMaybeDate(input);
  if (!d) return 0;
  return Math.max(0, Date.now() - d.getTime());
}

function humanizeSourceKey(key: string) {
  if (key === "metaAds") return "Meta Ads";
  if (key === "googleAds") return "Google Ads";
  if (key === "ga4") return "GA4";
  return key;
}

function getStageCeiling(stage: string, signalReadyForPdf: boolean) {
  if (signalReadyForPdf) return 100;

  switch (stage) {
    case "waiting_for_sources":
    case "loading_sources":
      return 18;
    case "awaiting_rebuild":
      return 24;
    case "waiting_for_connected_sources":
      return 34;
    case "compacting_sources":
    case "compacting_partial_sources":
      return 54;
    case "encoding_signal":
    case "encoding_context":
      return 84;
    case "waiting_for_valid_signal":
      return 92;
    case "completed":
    case "completed_partial":
      return 100;
    case "failed":
      return 100;
    default:
      return 12;
  }
}

function stageLabel(stage: string, usedOpenAI?: boolean) {
  switch (stage) {
    case "waiting_for_sources":
    case "loading_sources":
      return "Collecting connected datasets";
    case "awaiting_rebuild":
      return "Refreshing your Signal";
    case "waiting_for_connected_sources":
      return "Waiting for connected sources";
    case "compacting_sources":
    case "compacting_partial_sources":
      return "Compacting marketing data";
    case "encoding_signal":
    case "encoding_context":
      return usedOpenAI ? "Generating your Signal" : "Preparing your Signal";
    case "waiting_for_valid_signal":
      return "Validating your final Signal";
    case "completed":
    case "completed_partial":
      return "Your Signal is ready";
    case "failed":
      return "Signal build failed";
    default:
      return "Preparing your Signal";
  }
}

function stageHint(
  stage: string,
  pendingConnectedSources: string[],
  buildError: string | null,
  needSignalRebuild: boolean,
  effectiveSourcesChanged: boolean
) {
  const pendingLabel =
    pendingConnectedSources.length > 0
      ? pendingConnectedSources.map(humanizeSourceKey).join(", ")
      : "";

  if (needSignalRebuild && effectiveSourcesChanged) {
    return "We detected a change in your connected sources. We’re rebuilding the Signal so the export matches your latest data.";
  }

  switch (stage) {
    case "waiting_for_sources":
    case "loading_sources":
      return "We’re reading your connected marketing datasets and checking what’s ready to build.";
    case "awaiting_rebuild":
      return "We detected new connected data and we’re rebuilding your final Signal.";
    case "waiting_for_connected_sources":
      return pendingLabel
        ? `We’re waiting for the remaining connected sources to finish syncing: ${pendingLabel}.`
        : "We’re waiting for your remaining connected sources to finish syncing before generating the final Signal.";
    case "compacting_sources":
    case "compacting_partial_sources":
      return "We’re transforming your channel data into one unified cross-channel Signal.";
    case "encoding_signal":
    case "encoding_context":
      return "We’re generating the final Signal that powers your export.";
    case "waiting_for_valid_signal":
      return "Your data is almost ready. We’re validating the final Signal before enabling PDF generation.";
    case "completed":
    case "completed_partial":
      return "Your Signal is ready. You can now generate your premium PDF.";
    case "failed":
      return buildError
        ? `The build stopped: ${buildError}`
        : "Something interrupted the Signal generation flow. Retry to continue.";
    default:
      return "This usually takes a few seconds while we prepare your cross-channel data.";
  }
}

function formatPdfMeta(pdf: PdfStatus | null) {
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

function normalizePdfBuildState(raw?: string | null): PdfBuildState {
  switch (raw) {
    case "signal_not_ready":
    case "signal_rebuild_required":
    case "pdf_rebuild_required":
    case "pdf_processing":
    case "pdf_ready":
    case "pdf_failed":
      return raw;
    default:
      return "idle";
  }
}

function normalizeUiMode(raw?: string | null, pdfBuildState: PdfBuildState = "idle"): UiMode {
  if (pdfBuildState === "pdf_ready") return "pdf_ready";
  if (pdfBuildState === "pdf_processing") return "pdf_building";
  if (pdfBuildState === "pdf_failed") return "pdf_failed";
  if (pdfBuildState === "pdf_rebuild_required") return "pdf_rebuild_required";
  if (pdfBuildState === "signal_rebuild_required") return "signal_rebuild_required";
  if (pdfBuildState === "signal_not_ready") return "signal_not_ready";
  if (raw === "pdf_ready") return "pdf_ready";
  if (raw === "pdf_building") return "pdf_building";
  if (raw === "pdf_failed") return "pdf_failed";
  if (raw === "pdf_rebuild_required") return "pdf_rebuild_required";
  if (raw === "signal_rebuild_required") return "signal_rebuild_required";
  if (raw === "signal_not_ready") return "signal_not_ready";
  if (raw === "signal_ready") return "signal_ready";
  return "signal_building";
}

function getProgressBuildKey(s: CanonicalUiState | null) {
  if (!s) return null;
  return [
    s.buildAttemptId || "no-attempt",
    s.signalRunId || "no-run",
    s.currentSourceFingerprint || "no-current-fp",
    s.sourceFingerprint || "no-signal-fp",
    s.pdfBuildState || "no-pdf-build-state",
  ].join("|");
}

function deriveCanonicalStateFromStatus(payload?: ContextStatusData): CanonicalUiState {
  const status = payload?.status || "idle";
  const progress = clampProgress(payload?.progress ?? 0);
  const stage = String(payload?.stage || "idle");
  const pdf = payload?.pdf || {};
  const pdfStatusRaw = (pdf?.status || "idle") as "idle" | "processing" | "ready" | "failed";
  const pdfBuildState = normalizePdfBuildState(payload?.pdfBuildState || null);

  const staleSignal = !!payload?.staleSignal;
  const stalePdf = !!payload?.stalePdf;

  const sourceFingerprint = payload?.sourceFingerprint || null;
  const currentSourceFingerprint = payload?.currentSourceFingerprint || null;

  const fingerprintMismatch =
    !!sourceFingerprint &&
    !!currentSourceFingerprint &&
    sourceFingerprint !== currentSourceFingerprint;

  const needSignalRebuild = !!(payload?.needSignalRebuild ?? payload?.needsSignalRebuild ?? staleSignal ?? false);
  const effectiveSourcesChanged = !!(payload?.effectiveSourcesChanged || fingerprintMismatch);
  const needPdfRebuildBase = !!(payload?.needPdfRebuild ?? payload?.needsPdfRebuild ?? stalePdf ?? false);
  const needPdfRebuild = needPdfRebuildBase || needSignalRebuild || effectiveSourcesChanged;

  const signalBlocked =
    needSignalRebuild ||
    staleSignal ||
    effectiveSourcesChanged ||
    pdfBuildState === "signal_rebuild_required";
  const signalReadyForPdf = !!payload?.signalReadyForPdf && !signalBlocked;
  const hasSignal =
    !!(payload?.hasSignal || payload?.signalReady || payload?.signalComplete || payload?.signalValidForPdf) &&
    !signalBlocked;
  const signalComplete = !!payload?.signalComplete && !signalBlocked;
  const signalValidForPdf = !!payload?.signalValidForPdf && !signalBlocked && signalComplete;

  const pdfReady =
    (pdfBuildState === "pdf_ready" ||
      !!(payload?.pdfReady || payload?.hasPdf || pdf?.ready || pdfStatusRaw === "ready")) &&
    !needPdfRebuild &&
    !signalBlocked &&
    !stalePdf;

  const pdfProcessing =
    !pdfReady &&
    !signalBlocked &&
    !needPdfRebuild &&
    (pdfBuildState === "pdf_processing" || !!(payload?.pdfProcessing || pdfStatusRaw === "processing"));

  const pdfFailed =
    !pdfReady &&
    !pdfProcessing &&
    !signalBlocked &&
    (pdfBuildState === "pdf_failed" || !!(payload?.pdfFailed || pdfStatusRaw === "failed"));

  const backendCanGenerate = payload?.canGeneratePdf;
  const canGeneratePdf =
    (typeof backendCanGenerate === "boolean"
      ? backendCanGenerate
      : signalReadyForPdf && !pdfReady && !pdfProcessing) &&
    signalReadyForPdf &&
    !needSignalRebuild &&
    !staleSignal &&
    !needPdfRebuild;

  const backendCanDownload = payload?.canDownloadPdf;
  const canDownloadPdf =
    (typeof backendCanDownload === "boolean" ? backendCanDownload : pdfReady) &&
    pdfReady &&
    !pdfProcessing &&
    !needSignalRebuild &&
    !needPdfRebuild &&
    !staleSignal &&
    !stalePdf;

  const uiMode: UiMode = normalizeUiMode(payload?.uiMode || "signal_building", pdfBuildState);

  const nextPdfStatus: "idle" | "processing" | "ready" | "failed" =
    pdfBuildState === "pdf_ready"
      ? "ready"
      : pdfBuildState === "pdf_processing"
      ? "processing"
      : pdfBuildState === "pdf_failed"
      ? "failed"
      : pdfBuildState === "signal_rebuild_required" ||
        pdfBuildState === "signal_not_ready" ||
        pdfBuildState === "pdf_rebuild_required" ||
        needSignalRebuild ||
        needPdfRebuild ||
        staleSignal ||
        stalePdf ||
        effectiveSourcesChanged
      ? "idle"
      : pdfReady
      ? "ready"
      : pdfProcessing
      ? "processing"
      : pdfFailed
      ? "failed"
      : pdfStatusRaw;

  return {
    buildStatus: status,
    buildStage: stage,
    serverProgress: progress,
    startedAt: payload?.startedAt || null,
    finishedAt: payload?.finishedAt || null,
    buildAttemptId: payload?.buildAttemptId || null,
    signalRunId: payload?.signalRunId || null,

    hasEncodedPayload: !needSignalRebuild && !staleSignal && !!payload?.hasEncodedPayload,
    hasSignal,
    signalComplete,
    signalValidForPdf,
    signalReadyForPdf,
    hasPdf: pdfReady,

    pdfReady,
    pdfProcessing,
    pdfFailed,
    canGeneratePdf,
    canDownloadPdf,
    uiMode,
    pdfBuildState,

    connectedSources: Array.isArray(payload?.connectedSources) ? payload.connectedSources : [],
    usableSources: Array.isArray(payload?.usableSources) ? payload.usableSources : [],
    pendingConnectedSources: Array.isArray(payload?.pendingConnectedSources) ? payload.pendingConnectedSources : [],
    failedSources: Array.isArray(payload?.failedSources) ? payload.failedSources : [],

    pdfStatus: nextPdfStatus,
    pdfStage:
      pdfBuildState === "signal_rebuild_required" ||
      pdfBuildState === "signal_not_ready" ||
      pdfBuildState === "pdf_rebuild_required" ||
      needSignalRebuild ||
      needPdfRebuild ||
      staleSignal ||
      stalePdf ||
      effectiveSourcesChanged
        ? "idle"
        : (pdf?.stage || "idle"),
    pdfDownloadUrl:
      needSignalRebuild || needPdfRebuild || staleSignal || stalePdf || effectiveSourcesChanged
        ? null
        : (pdf?.downloadUrl || "/api/mcp/context/pdf/download"),
    pdfFileName:
      needSignalRebuild || needPdfRebuild || staleSignal || stalePdf || effectiveSourcesChanged
        ? null
        : (pdf?.fileName || null),
    pdfError:
      needSignalRebuild || staleSignal || effectiveSourcesChanged
        ? null
        : (pdf?.error || null),
    pdfMeta:
      needSignalRebuild || needPdfRebuild || staleSignal || stalePdf || effectiveSourcesChanged
        ? null
        : formatPdfMeta(pdf),

    usedOpenAI: !!payload?.usedOpenAI,
    model: payload?.model || null,
    buildError: payload?.error || null,

    snapshotId: payload?.snapshotId || null,
    sourceFingerprint,
    currentSourceFingerprint,
    currentSourcesSnapshot: payload?.currentSourcesSnapshot || null,
    connectionFingerprint: payload?.connectionFingerprint || null,

    staleSignal,
    stalePdf,
    needSignalRebuild,
    needPdfRebuild,
    effectiveSourcesChanged,
  };
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
  usedOpenAI,
  model,
  error,
  pendingConnectedSources,
  needSignalRebuild,
  effectiveSourcesChanged,
  isRetryDisabled,
  onRetry,
  signalReadyForPdf,
  isSignalReady,
}: {
  progress: number;
  status: "idle" | "processing" | "done" | "error";
  stage: string;
  usedOpenAI: boolean;
  model: string | null;
  error: string | null;
  pendingConnectedSources: string[];
  needSignalRebuild: boolean;
  effectiveSourcesChanged: boolean;
  isRetryDisabled: boolean;
  onRetry: () => void;
  signalReadyForPdf: boolean;
  isSignalReady: boolean;
}) {
  const showSuccess = isSignalReady && status !== "error";
  const displayProgress = showSuccess ? 100 : progress;
  const label = showSuccess
    ? "Signal structured and ready"
    : stage === "waiting_for_connected_sources"
    ? "Waiting for connected campaign sources"
    : stage === "awaiting_rebuild"
    ? "Rebuilding your Signal with fresh source data"
    : stage === "encoding_signal" || stage === "encoding_context"
    ? "Structuring your campaign data into intelligence"
    : stage === "waiting_for_valid_signal"
    ? "Final validation before unlock"
    : stage === "failed"
    ? "We couldn’t finish this build"
    : "Structuring your campaign data";

  const hint = showSuccess
    ? "Your Signal is complete. You can now generate the PDF export in the next step."
    : stageHint(stage, pendingConnectedSources, error, needSignalRebuild, effectiveSourcesChanged);

  const wrapperTone = showSuccess
    ? "border-[#4FE3C1]/20 bg-[linear-gradient(180deg,rgba(79,227,193,0.08),rgba(255,255,255,0.03))]"
    : "border-white/10 bg-white/[0.03]";

  const badgeTone = showSuccess
    ? "border-[#4FE3C1]/22 bg-[#4FE3C1]/10 text-[#CFFFF0]"
    : "border-[#B55CFF]/18 bg-[#B55CFF]/10 text-[#E7D3FF]";

  const panelTone = showSuccess
    ? "border-[#4FE3C1]/16 bg-[linear-gradient(180deg,rgba(9,10,13,0.78),rgba(9,10,13,0.9))]"
    : "border-white/10 bg-[#090A0D]/80";

  const progressBarTone = showSuccess
    ? "bg-[linear-gradient(90deg,#4FE3C1_0%,#7CF5D9_55%,#B9FFE9_100%)] shadow-[0_0_20px_rgba(79,227,193,0.35)]"
    : "bg-[linear-gradient(90deg,#B55CFF_0%,#D66BFF_55%,#4FE3C1_100%)] shadow-[0_0_20px_rgba(181,92,255,0.35)]";

  return (
    <div className="mt-6">
      <div className={`adray-border-flow relative overflow-hidden rounded-[30px] border p-5 sm:rounded-[32px] sm:p-6 ${wrapperTone}`}>
        <div className="absolute inset-0 pointer-events-none opacity-70">
          <div
            className={`absolute -top-20 left-0 h-56 w-56 rounded-full blur-3xl ${
              showSuccess ? "bg-[#4FE3C1]/14" : "bg-[#B55CFF]/14"
            }`}
          />
          <div
            className={`absolute -bottom-20 right-0 h-56 w-56 rounded-full blur-3xl ${
              showSuccess ? "bg-[#B8FFF0]/10" : "bg-[#4FE3C1]/10"
            }`}
          />
        </div>

        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${badgeTone}`}>
                {showSuccess ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                SIGNAL BUILDER
              </div>

              <div className="mt-4 text-xl font-bold text-white/95 sm:text-2xl">{label}</div>

              <p className="mt-2 max-w-2xl text-sm leading-7 text-white/58">{hint}</p>
            </div>

            <div className="shrink-0 text-right">
              <div className={`text-3xl font-extrabold sm:text-4xl ${showSuccess ? "text-[#CFFFF0]" : "text-white/95"}`}>
                {displayProgress}%
              </div>
              <div className="mt-1 text-xs text-white/45">
                {showSuccess
                  ? "Ready for PDF"
                  : usedOpenAI
                  ? `Powered by ${model || "OpenAI"}`
                  : "Signal in progress"}
              </div>
            </div>
          </div>

          <div className={`adray-progress-shell mt-5 rounded-[24px] border p-4 sm:p-5 ${panelTone}`}>
            <div className="h-3 w-full overflow-hidden rounded-full border border-white/10 bg-white/[0.05]">
              <div
                className={`h-full rounded-full transition-[width] duration-700 ease-out ${progressBarTone}`}
                style={{ width: `${displayProgress}%` }}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-white/58">
                {status === "error" ? (
                  <span className="inline-flex h-2 w-2 rounded-full bg-red-400" />
                ) : showSuccess ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#4FE3C1]" />
                ) : status === "done" ? (
                  <span className="inline-flex h-2 w-2 rounded-full bg-[#4FE3C1]" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#B55CFF]" />
                )}

                <span>
                  {status === "error"
                    ? "Build interrupted"
                    : showSuccess
                    ? "Signal complete"
                    : status === "done"
                    ? "Signal completed"
                    : "Structuring data"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    showSuccess
                      ? "border-[#4FE3C1]/18 bg-[#4FE3C1]/10 text-[#CFFFF0]"
                      : "border-white/10 bg-white/[0.03] text-white/68"
                  }`}
                >
                  {showSuccess ? "signal ready" : stage.split("_").join(" ")}
                </span>

                {!showSuccess && pendingConnectedSources.length > 0 && status === "processing" ? (
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/68">
                    Waiting for {pendingConnectedSources.map(humanizeSourceKey).join(", ")}
                  </span>
                ) : null}

                {needSignalRebuild && effectiveSourcesChanged ? (
                  <span className="rounded-full border border-[#B55CFF]/20 bg-[#B55CFF]/10 px-2.5 py-1 text-[11px] text-[#E7D3FF]">
                    Source change detected
                  </span>
                ) : null}

                {showSuccess && signalReadyForPdf ? (
                  <span className="rounded-full border border-[#4FE3C1]/18 bg-[#4FE3C1]/10 px-2.5 py-1 text-[11px] text-[#CFFFF0]">
                    Ready for PDF
                  </span>
                ) : null}

                {error && status === "error" ? (
                  <span className="rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-1 text-[11px] text-red-200/85">
                    {error}
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

function WhileYouWaitCard({ isSignalReady }: { isSignalReady: boolean }) {
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
          Your Signal becomes a PDF you can drop into any AI — Claude, ChatGPT, Gemini, Grok, or DeepSeek — to ask questions about performance in plain English. No integration work. Just attach and ask.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            "Download your Signal PDF when it’s ready",
            "Open any AI and attach the PDF to your conversation",
            "Ask about winners, budget shifts, losses, and next best actions",
          ].map((step, index) => (
            <div
              key={step}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 sm:p-4"
            >
              <div className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#B55CFF]/30 bg-[#B55CFF]/15 text-[11px] font-semibold text-[#E7D3FF]">
                {index + 1}
              </div>
              <p className="mt-2 text-sm leading-6 text-white/72">{step}</p>
            </div>
          ))}
        </div>

        {isSignalReady ? (
          <p className="mt-4 text-xs text-[#CFFFF0]/80">Your Signal is already ready, so you can move directly to the PDF step below.</p>
        ) : null}
      </div>
    </div>
  );
}

function PdfLaunchCard({
  canGenerate,
  signalReadyForPdf,
  needSignalRebuild,
  needPdfRebuild,
  pdfBuildState,
  pdfStatus,
  pdfFileName,
  pdfMeta,
  pdfError,
  isSubmitting,
  onGenerate,
  onDownload,
}: {
  canGenerate: boolean;
  signalReadyForPdf: boolean;
  needSignalRebuild: boolean;
  needPdfRebuild: boolean;
  pdfBuildState: PdfBuildState;
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
  const waitingForSignal = !signalReadyForPdf && !needSignalRebuild;
  const rebuildingSignal = needSignalRebuild || pdfBuildState === "signal_rebuild_required";
  const waitingForPdfRebuild = needPdfRebuild || pdfBuildState === "pdf_rebuild_required";
  const canStart = canGenerate && !isSubmitting && (pdfStatus === "idle" || pdfStatus === "failed");

  const title = isReady
    ? "Your PDF is ready"
    : isGenerating
    ? "Generating your Signal PDF"
    : rebuildingSignal
    ? "Rebuilding Signal before PDF"
    : waitingForSignal
    ? "Waiting for Signal to be ready"
    : waitingForPdfRebuild
    ? "PDF needs regeneration"
    : canGenerate
    ? "Your Signal is ready"
    : isFailed
    ? "PDF generation failed"
    : "Unlocks automatically when your Signal is ready";

  const description = isReady
    ? pdfFileName || "Download your Signal PDF export."
    : isGenerating
    ? "We’re generating the PDF now. This usually takes a few seconds."
    : rebuildingSignal
    ? "Your sources changed and we’re rebuilding Signal state before allowing PDF generation."
    : waitingForSignal
    ? "We’ll unlock PDF generation as soon as the backend marks your Signal as ready."
    : waitingForPdfRebuild
    ? "Your previous PDF is outdated for the latest Signal. Generate a fresh PDF export."
    : canGenerate
    ? pdfError
      ? `Last PDF attempt failed: ${pdfError}`
      : "Generate your PDF export when you’re ready."
    : isFailed
    ? `Last PDF attempt failed${pdfError ? `: ${pdfError}` : "."}`
    : "Usually less than a minute.";

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
                  isReady
                    ? "border-[#4FE3C1]/25 bg-[#4FE3C1]/10"
                    : canGenerate || isFailed
                    ? "border-[#B55CFF]/25 bg-[#B55CFF]/10"
                    : "border-white/10 bg-white/[0.04]",
                ].join(" ")}
              >
                {isReady ? (
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
                  {isReady
                    ? "Download PDF"
                    : isGenerating
                    ? "Generating PDF"
                    : rebuildingSignal
                    ? "Rebuilding Signal"
                    : waitingForSignal
                    ? "Waiting for Signal"
                    : canGenerate
                    ? "Generate PDF"
                    : isFailed
                    ? "Retry PDF"
                    : "Waiting for Signal"}
                </p>
                <p className="mt-1 text-xs text-white/48 break-words">{isReady ? (pdfFileName || "Signal export ready") : description}</p>
                {isReady && pdfMeta ? (
                  <p className="mt-1 text-[11px] text-white/38">{pdfMeta}</p>
                ) : null}
              </div>
            </div>

            {isReady ? (
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
  className="w-auto max-w-[90%] object-contain opacity-95 transition-transform duration-300 group-hover:scale-[1.03] max-h-[170px] sm:max-h-[210px] xl:max-h-[250px]"
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
  const [visualProgress, setVisualProgress] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [isGeneratingPdfIntent, setIsGeneratingPdfIntent] = useState(false);

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
  const keepWarmPollingRef = useRef(true);
  const progressBuildKeyRef = useRef<string | null>(null);
  const pageMountedAtRef = useRef<number>(Date.now());

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

  const applyStatus = (
    payload?: ContextStatusData,
    options?: { force?: boolean; seq?: number }
  ) => {
    if (!payload) return null;

    const seq = options?.seq ?? 0;
    const next = deriveCanonicalStateFromStatus(payload);

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

    if (next.currentSourceFingerprint) {
      if (
        lastKnownFingerprintRef.current &&
        lastKnownFingerprintRef.current !== next.currentSourceFingerprint
      ) {
        sourceChangeObservedRef.current = true;
      }
      lastKnownFingerprintRef.current = next.currentSourceFingerprint;
    }

    if (
      (next.signalReadyForPdf || next.pdfReady) &&
      !next.needSignalRebuild &&
      !next.staleSignal &&
      !next.effectiveSourcesChanged
    ) {
      sourceChangeObservedRef.current = false;
    }

    if (next.pdfReady || next.pdfFailed) {
      setIsGeneratingPdfIntent(false);
      manualPdfInFlightRef.current = false;
    }

    if (
      next.signalReadyForPdf ||
      next.buildStatus === "processing" ||
      next.buildStatus === "done" ||
      next.needSignalRebuild
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

  const isWithinStabilizationWindow = (s: CanonicalUiState | null) => {
    if (!s) return false;
    if (!s.finishedAt) return false;
    return msSince(s.finishedAt) < 12000;
  };

  const isReadyLikeState = (s: CanonicalUiState | null) => {
    if (!s) return false;
    return s.uiMode === "pdf_ready" || s.uiMode === "signal_ready";
  };

  const shouldKeepPolling = (s: CanonicalUiState | null) => {
    if (!s) return true;
    if (sourceChangeObservedRef.current) return true;
    if (s.needSignalRebuild || s.needPdfRebuild) return true;
    if (s.staleSignal || s.stalePdf) return true;
    if (s.effectiveSourcesChanged) return true;
    if (s.buildStatus === "processing") return true;
    if (s.uiMode === "signal_building") return true;
    if (s.uiMode === "pdf_building") return true;
    if (isWithinStabilizationWindow(s)) return true;
    if (keepWarmPollingRef.current && isReadyLikeState(s)) return true;
    return false;
  };

  const getNextPollDelay = (s: CanonicalUiState | null) => {
    const timeOnPageMs = Date.now() - pageMountedAtRef.current;
    const inInitialWatchWindow = timeOnPageMs < 18000;

    if (!s) return 1400;

    if (s.buildStatus === "processing" || s.uiMode === "signal_building" || s.uiMode === "pdf_building") {
      return 1200;
    }

    if (s.needSignalRebuild || s.needPdfRebuild || s.staleSignal || s.stalePdf || s.effectiveSourcesChanged) {
      return 1100;
    }

    if (isReadyLikeState(s)) {
      return inInitialWatchWindow ? 1200 : 4000;
    }

    return 1800;
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

    if (current.needSignalRebuild || current.staleSignal || current.effectiveSourcesChanged) {
      bootHasTriggeredBuildRef.current = true;
      const rebuilt = await buildContext(true);
      if (shouldKeepPolling(rebuilt)) schedulePoll(getNextPollDelay(rebuilt));
      return;
    }

    if (current.buildStatus === "processing") {
      bootHasTriggeredBuildRef.current = true;
      schedulePoll(getNextPollDelay(current));
      return;
    }

    if (current.uiMode === "pdf_building") {
      bootHasTriggeredBuildRef.current = true;
      schedulePoll(getNextPollDelay(current));
      return;
    }

    if (current.uiMode === "pdf_ready") {
      schedulePoll(getNextPollDelay(current));
      return;
    }

    if (current.uiMode === "signal_ready") {
      schedulePoll(getNextPollDelay(current));
      return;
    }

    if (
      current.buildStatus === "idle" &&
      !current.hasSignal &&
      !current.signalComplete &&
      !current.signalReadyForPdf
    ) {
      bootHasTriggeredBuildRef.current = true;
      const built = await buildContext(false);
      if (shouldKeepPolling(built)) schedulePoll(getNextPollDelay(built));
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
    pageMountedAtRef.current = Date.now();

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
      pageMountedAtRef.current = Date.now();
      hardRefreshStatus();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        pageMountedAtRef.current = Date.now();
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
      pageMountedAtRef.current = Date.now();
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

  useEffect(() => {
    if (!statusHydrated || !state) return;

    const buildKey = getProgressBuildKey(state);
    const isFreshSignalBuild =
      state.uiMode === "signal_building" &&
      (state.buildStatus === "processing" || state.needSignalRebuild);
    const shouldResetInheritedProgress =
      state.needSignalRebuild ||
      state.effectiveSourcesChanged ||
      state.buildStage === "awaiting_rebuild" ||
      state.pdfBuildState === "signal_rebuild_required" ||
      state.pdfBuildState === "signal_not_ready";

    if (isFreshSignalBuild && buildKey && progressBuildKeyRef.current !== buildKey) {
      progressBuildKeyRef.current = buildKey;

      const initialProgress =
        shouldResetInheritedProgress
          ? state.buildStage === "awaiting_rebuild"
            ? 12
            : state.buildStage === "waiting_for_connected_sources"
            ? 16
            : 8
          : state.serverProgress > 0
          ? Math.min(state.serverProgress, getStageCeiling(state.buildStage, state.signalReadyForPdf))
          : state.buildStage === "awaiting_rebuild"
          ? 14
          : state.buildStage === "waiting_for_connected_sources"
          ? 18
          : state.buildStage === "encoding_signal" || state.buildStage === "encoding_context"
          ? 56
          : 8;

      setVisualProgress(initialProgress);
    }

    if (state.uiMode !== "signal_building") {
      progressBuildKeyRef.current = buildKey;
      setVisualProgress(100);
      return;
    }

    if (state.buildStatus === "error") {
      setVisualProgress((prev) => Math.max(prev, state.serverProgress));
      return;
    }

    const interval = window.setInterval(() => {
      setVisualProgress((prev) => {
        const ceiling = getStageCeiling(state.buildStage, state.signalReadyForPdf);
        const elapsedMs = msSince(state.startedAt);
        const guardedServerProgress = shouldResetInheritedProgress
          ? Math.min(state.serverProgress, ceiling)
          : state.serverProgress;

        const stageDrift =
          state.buildStage === "waiting_for_sources" || state.buildStage === "loading_sources"
            ? Math.min(ceiling, 8 + Math.floor(elapsedMs / 2500))
            : state.buildStage === "awaiting_rebuild"
            ? Math.min(ceiling, 16 + Math.floor(elapsedMs / 2500))
            : state.buildStage === "waiting_for_connected_sources"
            ? Math.min(ceiling, 22 + Math.floor(elapsedMs / 3500))
            : state.buildStage === "compacting_sources" || state.buildStage === "compacting_partial_sources"
            ? Math.min(ceiling, 42 + Math.floor(elapsedMs / 2800))
            : state.buildStage === "encoding_signal" || state.buildStage === "encoding_context"
            ? Math.min(ceiling, 68 + Math.floor(elapsedMs / 3200))
            : state.buildStage === "waiting_for_valid_signal"
            ? Math.min(ceiling, 86 + Math.floor(elapsedMs / 4000))
            : Math.min(ceiling, guardedServerProgress);

        const desired = Math.max(guardedServerProgress, stageDrift);

        if (prev >= desired) return prev;

        const step =
          desired - prev > 20 ? 5 :
          desired - prev > 10 ? 3 :
          1;

        return Math.min(desired, prev + step, ceiling);
      });
    }, 180);

    return () => window.clearInterval(interval);
  }, [statusHydrated, state]);

  const onRetrySignal = async () => {
    if (!state) return;
    if (state.buildStatus === "processing" || isGeneratingPdfIntent || state.pdfProcessing) return;

    latestAppliedSeqRef.current = 0;
    requestSeqRef.current = 0;
    bootHasTriggeredBuildRef.current = false;
    manualBuildInFlightRef.current = false;
    manualPdfInFlightRef.current = false;
    sourceChangeObservedRef.current = false;
    progressBuildKeyRef.current = null;
    pageMountedAtRef.current = Date.now();

    setState((prev) =>
      prev
        ? {
            ...prev,
            buildStatus: "idle",
            buildStage: "idle",
            buildError: null,
            serverProgress: 0,
            hasEncodedPayload: false,
            hasSignal: false,
            signalComplete: false,
            signalValidForPdf: false,
            signalReadyForPdf: false,
            hasPdf: false,
            pdfReady: false,
            pdfProcessing: false,
            pdfFailed: false,
            canGeneratePdf: false,
            canDownloadPdf: false,
            uiMode: "signal_building",
            pdfStatus: "idle",
            pdfStage: "idle",
            pdfFileName: null,
            pdfError: null,
            pdfMeta: null,
            staleSignal: false,
            stalePdf: false,
            needSignalRebuild: true,
            needPdfRebuild: true,
            effectiveSourcesChanged: false,
          }
        : prev
    );

    setVisualProgress(0);
    setIsGeneratingPdfIntent(false);
    stopPolling();

    bootHasTriggeredBuildRef.current = true;
    const built = await buildContext(true);
    if (shouldKeepPolling(built)) schedulePoll(getNextPollDelay(built));
  };

  const onGeneratePdf = async () => {
    if (!state) return;
    if (!(state.canGeneratePdf && state.signalReadyForPdf)) return;
    if (state.needSignalRebuild) return;
    if (isGeneratingPdfIntent || state.pdfProcessing || manualPdfInFlightRef.current) return;

    try {
      setIsGeneratingPdfIntent(true);

      await activateDailyDeliveryOnGeneratePdf();

      const result = await buildPdf(state.pdfStatus === "failed");

      if (!result) {
        schedulePoll();
        return;
      }

      if (result.pdfReady || result.uiMode === "pdf_ready" || result.pdfBuildState === "pdf_ready") {
        setIsGeneratingPdfIntent(false);
        manualPdfInFlightRef.current = false;
        showToast("Your PDF is ready");
        schedulePoll(getNextPollDelay(result));
        return;
      }

      if (result.pdfProcessing || result.uiMode === "pdf_building" || result.pdfBuildState === "pdf_processing") {
        schedulePoll(getNextPollDelay(result));
        return;
      }

      if (result.pdfBuildState === "signal_rebuild_required" || result.pdfBuildState === "signal_not_ready") {
        setIsGeneratingPdfIntent(false);
        manualPdfInFlightRef.current = false;
        showToast("Signal needs to rebuild before generating the PDF");
        await buildContext(true);
        schedulePoll(900);
        return;
      }

      if (result.pdfBuildState === "pdf_rebuild_required") {
        setIsGeneratingPdfIntent(false);
        manualPdfInFlightRef.current = false;
        showToast("A fresh PDF is required for the latest Signal");
        schedulePoll(900);
        return;
      }

      if (result.pdfBuildState === "pdf_failed") {
        setIsGeneratingPdfIntent(false);
        manualPdfInFlightRef.current = false;
        showToast("PDF generation failed. Please retry.");
        schedulePoll(1400);
        return;
      }

      const fresh = await fetchStatus({ force: true });

      if (fresh?.pdfReady || fresh?.uiMode === "pdf_ready" || fresh?.pdfBuildState === "pdf_ready") {
        setIsGeneratingPdfIntent(false);
        manualPdfInFlightRef.current = false;
        showToast("Your PDF is ready");
        schedulePoll(getNextPollDelay(fresh));
        return;
      }

      if (fresh?.pdfProcessing || fresh?.uiMode === "pdf_building" || fresh?.pdfBuildState === "pdf_processing") {
        schedulePoll(getNextPollDelay(fresh));
        return;
      }

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
              pdfStage: "failed",
              pdfProcessing: false,
              pdfFailed: true,
              canGeneratePdf: prev.signalReadyForPdf && !prev.needSignalRebuild,
              canDownloadPdf: false,
              pdfError: err?.message || "Failed to build PDF",
              needPdfRebuild: true,
            }
          : prev
      );
      schedulePoll(1800);
    }
  };

  const onDownloadPdf = () => {
    if (!state) return;
    if (!state.canDownloadPdf) return;

    const url = state.pdfDownloadUrl || "/api/mcp/context/pdf/download";
    window.open(url, "_blank", "noopener,noreferrer");
    showToast("Your PDF download has started");
    schedulePoll(getNextPollDelay(state));
  };

  const displayPdfStatus: "idle" | "processing" | "ready" | "failed" = useMemo(() => {
    if (!state) return "idle";
    if (state.pdfBuildState === "pdf_ready") return "ready";
    if (state.pdfBuildState === "pdf_processing") return "processing";
    if (state.pdfBuildState === "pdf_failed") return "failed";
    if (
      state.pdfBuildState === "signal_rebuild_required" ||
      state.pdfBuildState === "signal_not_ready" ||
      state.pdfBuildState === "pdf_rebuild_required"
    ) {
      return "idle";
    }
    if (state.pdfReady) return "ready";
    if (state.needSignalRebuild || state.needPdfRebuild || state.staleSignal || state.stalePdf) return "idle";
    if (state.pdfProcessing) return "processing";
    if (state.pdfFailed) return "failed";
    return state.pdfStatus;
  }, [state]);

  const signalReadyForPdf = !!state?.signalReadyForPdf;
  const uiMode = state?.uiMode || "signal_building";

  const isProcessingSignal =
    !!state &&
    (state.buildStatus === "processing" || state.needSignalRebuild) &&
    uiMode === "signal_building";

  const isSignalReadyCard =
    !!state &&
    state.signalReadyForPdf &&
    !state.needSignalRebuild &&
    !state.staleSignal &&
    !state.effectiveSourcesChanged;

  const heroChipText = useMemo(() => {
    if (!statusHydrated) return "Loading your export status";
    if (!state) return "Preparing your Signal";
    if (state.pdfBuildState === "signal_rebuild_required" || state.needSignalRebuild) {
      return "Signal rebuild required before PDF";
    }
    if (state.pdfBuildState === "signal_not_ready") return "Signal still processing";
    if (state.pdfBuildState === "pdf_rebuild_required" || state.needPdfRebuild) return "PDF needs regeneration";
    if (state.pdfBuildState === "pdf_failed" || uiMode === "pdf_failed") return "Last PDF generation failed";
    if (state.needSignalRebuild && state.effectiveSourcesChanged) return "We detected source changes and we’re rebuilding";
    if (uiMode === "pdf_ready") return "Your Signal and PDF are ready";
    if (uiMode === "pdf_building") return "Your PDF is being generated";
    if (uiMode === "signal_ready") return "Your Signal is ready";
    if (state.buildStatus === "processing" && state.buildStage === "waiting_for_connected_sources") {
      return "Waiting for your connected sources to finish syncing";
    }
    if (state.buildStatus === "processing" && state.buildStage === "waiting_for_valid_signal") {
      return "Your Signal is being validated";
    }
    if (state.buildStatus === "processing" && state.buildStage === "awaiting_rebuild") {
      return "Refreshing your Signal";
    }
    return "Preparing your Signal";
  }, [statusHydrated, state, uiMode]);

  const tipText = useMemo(() => {
    if (!statusHydrated) {
      return "We’re loading your latest Signal and PDF state.";
    }

    if (!state) {
      return "We’re building your Signal first. Once it is ready, you’ll be able to generate the PDF manually.";
    }

    if (state.pdfBuildState === "signal_rebuild_required" || state.needSignalRebuild) {
      return "Backend requested a Signal rebuild. We’re rebuilding now before enabling PDF generation.";
    }

    if (state.pdfBuildState === "signal_not_ready") {
      return "Your Signal is still being finalized. PDF generation unlocks automatically when backend marks it ready.";
    }

    if (state.pdfBuildState === "pdf_rebuild_required" || state.needPdfRebuild) {
      return "Your Signal is ready but the PDF is stale for the current data. Generate a fresh PDF export.";
    }

    if (state.pdfBuildState === "pdf_failed" || uiMode === "pdf_failed") {
      return state.pdfError
        ? `PDF generation failed: ${state.pdfError}`
        : "The last PDF build failed. Retry generation when you’re ready.";
    }

    if (state.needSignalRebuild && state.effectiveSourcesChanged) {
      return "Your connected sources changed. We’re rebuilding the Signal so your next PDF matches the latest connected data.";
    }

    if (uiMode === "pdf_ready") {
      return "Your Signal and premium PDF are ready. Download the file and use it inside your favorite AI tools.";
    }

    if (uiMode === "signal_ready") {
      return state.needPdfRebuild
        ? "Your Signal is ready and your PDF needs to be generated for the latest source state."
        : "Your Signal is ready. Click Generate PDF whenever you want to create your premium export.";
    }

    if (uiMode === "pdf_building") {
      return "Your Signal is done. We’re now generating the PDF.";
    }

    if (state.buildStatus === "processing" && state.buildStage === "awaiting_rebuild") {
      return "We detected a source change and we’re rebuilding the Signal so your export stays aligned with the latest connected data.";
    }

    if (state.buildStatus === "processing" && state.buildStage === "waiting_for_connected_sources") {
      return state.pendingConnectedSources.length > 0
        ? `We’re still waiting for ${state.pendingConnectedSources.map(humanizeSourceKey).join(", ")} to finish syncing before completing your Signal.`
        : "We’re waiting for your remaining connected sources to finish syncing before completing your Signal.";
    }

    if (state.buildStatus === "processing" && state.buildStage === "waiting_for_valid_signal") {
      return "Your cross-channel Signal is almost ready. We’re validating the final payload before enabling PDF generation.";
    }

    if (state.buildStatus === "error") {
      return `The Signal build stopped${state.buildError ? `: ${state.buildError}` : "."}`;
    }

    return "We’re building your Signal first. Once it is ready, you’ll be able to generate the PDF manually.";
  }, [statusHydrated, state, uiMode]);

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
                          <span className="truncate">{heroChipText}</span>
                        </div>

                        <div className="mt-5 min-w-0">
                          <p className="text-[11px] uppercase tracking-[0.24em] text-white/38">
                            Final Step · Signal Intelligence
                          </p>

                          <h1 className="mt-3 max-w-[820px] text-[1.9rem] font-extrabold leading-[0.96] tracking-[-0.04em] text-white/95 sm:text-[3.65rem]">
                            Your data is being turned into{" "}
                            <span className="gradient-text-soft">intelligence</span>
                          </h1>

                          <p className="mt-4 max-w-3xl text-[13px] leading-6 text-white/56 sm:text-[16px] sm:leading-7">
                            We’re pulling your campaign history, reconciling it across platforms, and structuring it so any AI can reason about it.
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
                  usedOpenAI={!!state?.usedOpenAI}
                  model={state?.model || null}
                  error={state?.buildError || null}
                  pendingConnectedSources={state?.pendingConnectedSources || []}
                  needSignalRebuild={!!state?.needSignalRebuild}
                  effectiveSourcesChanged={!!state?.effectiveSourcesChanged}
                  isRetryDisabled={isProcessingSignal || isGeneratingPdfIntent || displayPdfStatus === "processing"}
                  onRetry={onRetrySignal}
                  signalReadyForPdf={!!state?.signalReadyForPdf}
                  isSignalReady={isSignalReadyCard}
                />

                <div className="mt-6">
                  <WhileYouWaitCard isSignalReady={isSignalReadyCard} />
                </div>

                <div className="mt-6">
                  <PdfLaunchCard
                    canGenerate={!!state?.canGeneratePdf && signalReadyForPdf && !state?.needSignalRebuild}
                    signalReadyForPdf={!!state?.signalReadyForPdf}
                    needSignalRebuild={!!state?.needSignalRebuild}
                    needPdfRebuild={!!state?.needPdfRebuild}
                    pdfBuildState={state?.pdfBuildState || "idle"}
                    pdfStatus={displayPdfStatus}
                    pdfFileName={state?.pdfFileName || null}
                    pdfMeta={state?.pdfMeta || null}
                    pdfError={state?.pdfError || null}
                    isSubmitting={isGeneratingPdfIntent && displayPdfStatus !== "processing"}
                    onGenerate={onGeneratePdf}
                    onDownload={onDownloadPdf}
                  />
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
                  Tip: {tipText}
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
