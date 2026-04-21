// dashboard-src/src/pages/ClaudeMcp.tsx
//
// "Connect Adray to Claude" panel — second-level destination from the
// "Choose your AI" hub (/laststep). Guides the user to install the Adray
// MCP connector inside Claude:
//   1) Open Claude Settings -> Connections.
//   2) Add a connector pasting the Adray MCP URL.
//
// The route /claudemcp still points to this file (see App.tsx); only the
// content has been refactored to a lean premium panel per the product spec.

import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Gem,
  PlayCircle,
} from "lucide-react";

const ADRAY_MCP_URL = "https://adray.ai/mcp";
const CLAUDE_CONNECTORS_URL = "https://claude.ai/customize/connectors";

type Step = {
  index: number;
  title: string;
  description: string;
};

const STEPS: Step[] = [
  {
    index: 1,
    title: "Open Claude.ai",
    description:
      "and go to Settings → Connections. You'll need a Pro or Teams plan to access MCP connectors.",
  },
  {
    index: 2,
    title: 'Click "Add connector"',
    description:
      "and search for Adray, or paste the MCP URL from the button below.",
  },
  {
    index: 3,
    title: "Authorize the connection",
    description:
      "— you'll be redirected back to Adray to approve access. Takes about 30 seconds.",
  },
  {
    index: 4,
    title: "Start a new Claude conversation",
    description:
      "and ask about your ad performance, spend, or signal insights.",
  },
];

function HeaderPills() {
  const pillBase =
    "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold backdrop-blur-md";
  const done =
    "border-[#4FE3C1]/24 bg-[#4FE3C1]/8 text-[#9BEFD3]";
  const active =
    "border-[#B55CFF]/30 bg-[#B55CFF]/12 text-[#D8B8FF] shadow-[0_0_18px_rgba(181,92,255,0.14)]";

  return (
    <div className="flex items-center gap-2">
      <span className={[pillBase, done].join(" ")}>
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#4FE3C1]" />
        Activate data
      </span>
      <span className={[pillBase, active].join(" ")}>
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B55CFF]/50" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#D8B8FF]" />
        </span>
        Claude MCP
      </span>
    </div>
  );
}

function StepRow({ step }: { step: Step }) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#B55CFF]/30 bg-[#B55CFF]/10 text-xs font-semibold text-[#D8B8FF]">
        {step.index}
      </div>
      <p className="text-sm leading-7 text-white/82">
        <span className="font-semibold text-white/94">{step.title}</span>
        <span className="text-white/58"> {step.description}</span>
      </p>
    </div>
  );
}

async function safeCopy(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy fallback below
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export default function ClaudeMcp() {
  const nav = useNavigate();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  const handleCopy = async () => {
    const ok = await safeCopy(ADRAY_MCP_URL);
    if (!ok) return;
    setCopied(true);
    if (copyTimerRef.current) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const openClaudeSettings = () => {
    window.open(CLAUDE_CONNECTORS_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Top bar: pills + back */}
        <div className="mb-5 flex items-center justify-between gap-3 sm:mb-6">
          <HeaderPills />
          <Button
            variant="outline"
            onClick={() => nav("/laststep")}
            className="h-10 shrink-0 rounded-2xl border-white/10 bg-white/[0.04] px-4 text-sm text-white/75 backdrop-blur-md hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>

        {/* Hero card */}
        <Card className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.72)_0%,rgba(10,10,14,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-md">
          <div className="pointer-events-none absolute inset-0 opacity-60">
            <div className="absolute -top-24 right-0 h-64 w-64 rounded-full bg-[#B55CFF]/10 blur-3xl" />
            <div className="absolute -bottom-24 left-0 h-56 w-56 rounded-full bg-[#4FE3C1]/6 blur-3xl" />
            <div className="absolute inset-0 translate-x-[-120%] bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.03),transparent)] animate-[adray-shimmer_6s_ease-in-out_infinite]" />
          </div>

          <CardContent className="relative p-5 sm:p-8">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#D8B8FF]/65">
              Claude · MCP Connector
            </p>
            <h1 className="mt-3 text-[1.85rem] font-semibold tracking-[-0.03em] text-white sm:text-[2.4rem]">
              Connect Adray to Claude
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/58 sm:text-[0.95rem] sm:leading-7">
              Add Adray as an MCP data source inside Claude for a live,
              always-current view of your signal.
            </p>
          </CardContent>
        </Card>

        {/* Setup card */}
        <Card className="relative mt-5 overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.72)_0%,rgba(10,10,14,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-md sm:mt-6">
          <div className="pointer-events-none absolute inset-0 opacity-40">
            <div className="absolute -top-20 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-[#B55CFF]/8 blur-3xl" />
          </div>

          <CardContent className="relative p-5 sm:p-8">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#B55CFF]/28 bg-[#B55CFF]/10">
                <Gem className="h-3.5 w-3.5 text-[#D8B8FF]" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#D8B8FF]/65">
                Setup Instructions
              </p>
            </div>

            <div className="mt-6 space-y-5 sm:mt-7 sm:space-y-6">
              {STEPS.map((step) => (
                <StepRow key={step.index} step={step} />
              ))}
            </div>

            {/* Video walkthrough placeholder */}
            <div className="relative mt-7 overflow-hidden rounded-2xl border border-white/10 bg-black/30 backdrop-blur-md sm:mt-8">
              <div className="flex items-center justify-center py-12 sm:py-16">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/14 bg-white/[0.04] transition-all duration-300 hover:border-[#B55CFF]/30 hover:bg-[#B55CFF]/10">
                    <PlayCircle className="h-7 w-7 text-white/55" />
                  </div>
                  <p className="text-xs text-white/45">
                    Video walkthrough · 60 sec
                  </p>
                </div>
              </div>
            </div>

            {/* CTAs */}
            <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:items-center">
              <Button
                onClick={handleCopy}
                className="h-11 rounded-2xl bg-[#B55CFF] px-5 text-sm font-semibold text-white shadow-[0_0_24px_rgba(181,92,255,0.28)] transition-all hover:bg-[#A664FF] hover:shadow-[0_0_34px_rgba(181,92,255,0.4)]"
              >
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy MCP connector URL
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={openClaudeSettings}
                className="group h-11 rounded-2xl border-white/12 bg-white/[0.04] px-5 text-sm text-white/82 backdrop-blur-md hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
              >
                Open Claude Settings
                <ExternalLink className="ml-2 h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Button>
            </div>

            {/* Disclaimer */}
            <div className="mt-6 rounded-2xl border border-[#B55CFF]/18 bg-[#B55CFF]/8 px-4 py-3 text-xs leading-6 text-[#D8B8FF]/82 backdrop-blur-md sm:text-sm">
              MCP access requires a Claude Pro or Teams subscription on
              claude.ai. This is separate from your Adray plan.
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
