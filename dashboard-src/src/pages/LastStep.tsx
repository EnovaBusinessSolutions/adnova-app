// dashboard-src/src/pages/LastStep.tsx
//
// Hub "Choose your AI" — Step 2 of the onboarding flow.
// Lets the user pick how they want to consume the Adray Signal:
//   - ChatGPT (custom GPT, open to all)
//   - Claude (MCP connector, requires Pro/Teams)
//   - Signal  (exportable PDF, any LLM)
//
// The route /laststep still points to this file (see App.tsx); only the
// content has been refactored. The underlying Signal/PDF flow now lives in
// Signal.tsx at /signal.

import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { ParticleField } from "@/components/ParticleField";
import chatgptLogo from "@/assets/logos/chatgpt.png";
import claudeLogo from "@/assets/logos/claude.png";
import adrayIcon from "@/assets/adray-icon.png";
import { ArrowRight, Check } from "lucide-react";

type Accent = "emerald" | "purple" | "blue";
type TagTone = "emerald" | "purple" | "neutral";

type Provider = {
  key: "chatgpt" | "claude" | "signal";
  title: string;
  description: string;
  tag: string;
  tagTone: TagTone;
  icon: JSX.Element;
  to: string;
  accent: Accent;
};

const PROVIDERS: Provider[] = [
  {
    key: "chatgpt",
    title: "ChatGPT",
    description:
      "Use your signal in a custom GPT built for Adray. Works with any ChatGPT account.",
    tag: "Open to all",
    tagTone: "emerald",
    icon: (
      <img
        src={chatgptLogo}
        alt="ChatGPT"
        className="h-10 w-10 object-contain"
        draggable={false}
      />
    ),
    to: "/chatgptmcp",
    accent: "emerald",
  },
  {
    key: "claude",
    title: "Claude",
    description:
      "Connect via MCP for a live, structured data feed directly inside Claude. Requires a Claude Pro or Teams plan.",
    tag: "Requires Claude Pro",
    tagTone: "purple",
    icon: (
      <img
        src={claudeLogo}
        alt="Claude"
        className="h-10 w-10 object-contain"
        draggable={false}
      />
    ),
    to: "/claudemcp",
    accent: "purple",
  },
  {
    key: "signal",
    title: "Signal",
    description:
      "Generate a structured PDF of your Adray signal to paste into any AI tool — ChatGPT, Claude, Gemini, and more.",
    tag: "Any LLM",
    tagTone: "neutral",
    icon: (
      <img
        src={adrayIcon}
        alt="Adray Signal"
        className="h-10 w-10 object-contain"
        draggable={false}
      />
    ),
    to: "/signal",
    accent: "blue",
  },
];

function StepPills() {
  const pillBase =
    "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold backdrop-blur-md";
  const done =
    "border-[#4FE3C1]/24 bg-[#4FE3C1]/8 text-[#9BEFD3]";
  const active =
    "border-[#B55CFF]/30 bg-[#B55CFF]/12 text-[#D8B8FF] shadow-[0_0_18px_rgba(181,92,255,0.14)]";

  return (
    <div className="no-scrollbar -mx-1 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      <span className={[pillBase, done].join(" ")}>
        <Check className="h-3 w-3" />
        Step 1: Activate Data
      </span>
      <span className={[pillBase, active].join(" ")}>
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D8B8FF]/50" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#D8B8FF]" />
        </span>
        Step 2: Use in AI
      </span>
    </div>
  );
}

function getCardTheme(accent: Accent) {
  if (accent === "emerald") {
    return {
      iconWrap: "border-[#4FE3C1]/26 bg-[#4FE3C1]/10 text-[#9BEFD3]",
      hoverBorder: "hover:border-[#4FE3C1]/35",
      hoverGlow: "hover:shadow-[0_0_30px_rgba(79,227,193,0.14)]",
      glowTop: "bg-[#4FE3C1]/12",
      glowBottom: "bg-[#B55CFF]/8",
      beam: "from-[#4FE3C1]/16 via-white/[0.05] to-transparent",
    };
  }
  if (accent === "purple") {
    return {
      iconWrap: "border-[#B55CFF]/30 bg-[#B55CFF]/10 text-[#D8B8FF]",
      hoverBorder: "hover:border-[#B55CFF]/38",
      hoverGlow: "hover:shadow-[0_0_30px_rgba(181,92,255,0.14)]",
      glowTop: "bg-[#B55CFF]/12",
      glowBottom: "bg-[#4FE3C1]/8",
      beam: "from-[#B55CFF]/16 via-white/[0.05] to-transparent",
    };
  }
  return {
    iconWrap: "border-[#7CC8FF]/26 bg-[#7CC8FF]/10 text-[#BEDBF2]",
    hoverBorder: "hover:border-[#7CC8FF]/36",
    hoverGlow: "hover:shadow-[0_0_30px_rgba(124,200,255,0.14)]",
    glowTop: "bg-[#7CC8FF]/12",
    glowBottom: "bg-[#B55CFF]/8",
    beam: "from-[#7CC8FF]/16 via-white/[0.05] to-transparent",
  };
}

function getTagClass(tone: TagTone) {
  if (tone === "emerald") {
    return "border-[#4FE3C1]/26 bg-[#4FE3C1]/10 text-[#9BEFD3]";
  }
  if (tone === "purple") {
    return "border-[#B55CFF]/30 bg-[#B55CFF]/12 text-[#D8B8FF]";
  }
  return "border-white/14 bg-white/[0.05] text-white/72";
}

function ProviderCard({ provider }: { provider: Provider }) {
  const theme = getCardTheme(provider.accent);
  const tagClass = getTagClass(provider.tagTone);

  return (
    <Link to={provider.to} className="block focus:outline-none">
      <div
        className={[
          "group relative overflow-hidden rounded-[26px] border backdrop-blur-md transition-all duration-300",
          "border-white/10 bg-[linear-gradient(180deg,rgba(18,14,28,0.70)_0%,rgba(12,12,16,0.86)_100%)]",
          "p-4 sm:rounded-[30px] sm:p-5",
          "focus-visible:ring-2 focus-visible:ring-[#B55CFF]/40",
          theme.hoverBorder,
          theme.hoverGlow,
        ].join(" ")}
      >
        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <div
            className={[
              "absolute -top-16 right-0 h-44 w-44 rounded-full blur-3xl",
              theme.glowTop,
            ].join(" ")}
          />
          <div
            className={[
              "absolute -bottom-16 left-0 h-40 w-40 rounded-full blur-3xl",
              theme.glowBottom,
            ].join(" ")}
          />
          <div
            className={[
              "absolute inset-y-0 left-0 w-[42%] bg-gradient-to-r opacity-80",
              theme.beam,
            ].join(" ")}
          />
        </div>

        <div className="pointer-events-none absolute inset-0 rounded-[26px] border border-white/[0.03] sm:rounded-[30px]" />

        <div className="relative flex items-center gap-4">
          <div
            className={[
              "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border backdrop-blur-md",
              theme.iconWrap,
            ].join(" ")}
          >
            {provider.icon}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold text-white/94 sm:text-[1.05rem]">
                {provider.title}
              </p>
              <span
                className={[
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                  tagClass,
                ].join(" ")}
              >
                {provider.tag}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-6 text-white/58">
              {provider.description}
            </p>
          </div>

          <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-white/70 transition-all duration-300 group-hover:border-white/18 group-hover:bg-white/[0.08] group-hover:text-white group-hover:translate-x-0.5">
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function LastStep() {
  return (
    <DashboardLayout>
      <ParticleField variant="multiverse" count={28} />

      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <Card className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.72)_0%,rgba(10,10,14,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-md">
          <div className="pointer-events-none absolute inset-0 opacity-60">
            <div className="absolute -top-24 right-0 h-64 w-64 rounded-full bg-[#B55CFF]/10 blur-3xl" />
            <div className="absolute -bottom-24 left-0 h-56 w-56 rounded-full bg-[#4FE3C1]/6 blur-3xl" />
            <div className="absolute inset-0 translate-x-[-120%] bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.03),transparent)] animate-[adray-shimmer_6s_ease-in-out_infinite]" />
          </div>

          <CardContent className="relative p-5 sm:p-8">
            <StepPills />

            <div className="mt-7 sm:mt-9">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#E6D2FF]/65">
                Step 2 · Use in AI
              </p>
              <h1 className="mt-3 text-[1.85rem] font-semibold tracking-[-0.03em] text-white sm:text-[2.4rem]">
                Choose your AI
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/58 sm:text-[0.95rem] sm:leading-7">
                Select where you want to use your Adray signal. Each option gives
                you a different way to interact with your data.
              </p>
            </div>

            <div className="mt-7 space-y-3 sm:mt-9 sm:space-y-4">
              {PROVIDERS.map((provider) => (
                <ProviderCard key={provider.key} provider={provider} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
