// dashboard-src/src/pages/ChatGptMcp.tsx
//
// "Open Adray in ChatGPT" panel — second-level destination from the
// "Choose your AI" hub (/laststep). Guides the user to the Adray custom GPT
// with a single green CTA that opens the GPT in a new tab.
//
// The route /chatgptmcp still points to this file (see App.tsx); only the
// content has been refactored from a heavy link-management UI to a premium
// lean panel per the product spec.

import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { ParticleField } from "@/components/ParticleField";
import chatgptLogo from "@/assets/logos/chatgpt.png";

const ADRAY_GPT_URL =
  "https://chatgpt.com/g/g-69cb161b48f081918b69b14d8e1d9407-adray-analytics";

type Step = {
  index: number;
  title: string;
  description: string;
};

const STEPS: Step[] = [
  {
    index: 1,
    title: "Open the Adray GPT",
    description:
      "click the button below. You'll be taken directly to the custom GPT.",
  },
  {
    index: 2,
    title: "Sign in to ChatGPT",
    description: "if prompted. Any free or paid account works.",
  },
  {
    index: 3,
    title: "Start chatting",
    description:
      "ask about your campaigns, performance trends, or optimization ideas. Your signal is pre-loaded.",
  },
];

function HeaderPills() {
  const pillBase =
    "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold backdrop-blur-md";
  const done =
    "border-[#4FE3C1]/24 bg-[#4FE3C1]/8 text-[#9BEFD3]";
  const active =
    "border-[#4FE3C1]/30 bg-[#4FE3C1]/12 text-[#9BEFD3] shadow-[0_0_18px_rgba(79,227,193,0.14)]";

  return (
    <div className="flex items-center gap-2">
      <span className={[pillBase, done].join(" ")}>
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#4FE3C1]" />
        Activate data
      </span>
      <span className={[pillBase, active].join(" ")}>
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4FE3C1]/50" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#4FE3C1]" />
        </span>
        ChatGPT
      </span>
    </div>
  );
}

function StepRow({ step }: { step: Step }) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#4FE3C1]/30 bg-[#4FE3C1]/10 text-xs font-semibold text-[#9BEFD3]">
        {step.index}
      </div>
      <p className="text-sm leading-7 text-white/82">
        <span className="font-semibold text-white/94">{step.title}</span>
        <span className="text-white/58"> — {step.description}</span>
      </p>
    </div>
  );
}

export default function ChatGptMcp() {
  const nav = useNavigate();

  const openAdrayGpt = () => {
    window.open(ADRAY_GPT_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <DashboardLayout>
      <ParticleField variant="emerald" count={26} />

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

        {/* Hero card: label + heading + subtitle */}
        <Card className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.72)_0%,rgba(10,10,14,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-md">
          <div className="pointer-events-none absolute inset-0 opacity-60">
            <div className="absolute -top-24 right-0 h-64 w-64 rounded-full bg-[#4FE3C1]/10 blur-3xl" />
            <div className="absolute -bottom-24 left-0 h-56 w-56 rounded-full bg-[#B55CFF]/6 blur-3xl" />
            <div className="absolute inset-0 translate-x-[-120%] bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.03),transparent)] animate-[adray-shimmer_6s_ease-in-out_infinite]" />
          </div>

          <CardContent className="relative p-5 sm:p-8">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#9BEFD3]/65">
              ChatGPT · Custom GPT
            </p>
            <h1 className="mt-3 text-[1.85rem] font-semibold tracking-[-0.03em] text-white sm:text-[2.4rem]">
              Open Adray in ChatGPT
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/58 sm:text-[0.95rem] sm:leading-7">
              Your signal is ready. Follow these steps to load it into the Adray
              custom GPT.
            </p>
          </CardContent>
        </Card>

        {/* Setup card: instructions + CTA */}
        <Card className="relative mt-5 overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,14,28,0.72)_0%,rgba(10,10,14,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-md sm:mt-6">
          <div className="pointer-events-none absolute inset-0 opacity-40">
            <div className="absolute -top-20 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-[#4FE3C1]/8 blur-3xl" />
          </div>

          <CardContent className="relative p-5 sm:p-8">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#4FE3C1]/28 bg-[#4FE3C1]/10">
                <img
                  src={chatgptLogo}
                  alt="ChatGPT"
                  className="h-7 w-7 object-contain"
                  draggable={false}
                />
              </span>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#9BEFD3]/65">
                Setup Instructions
              </p>
            </div>

            <div className="mt-6 space-y-5 sm:mt-7 sm:space-y-6">
              {STEPS.map((step) => (
                <StepRow key={step.index} step={step} />
              ))}
            </div>

            <div className="mt-7 sm:mt-8">
              <Button
                onClick={openAdrayGpt}
                className="group h-11 rounded-2xl bg-[#4FE3C1] px-5 text-sm font-semibold text-[#0B0B0D] shadow-[0_0_24px_rgba(79,227,193,0.28)] transition-all hover:bg-[#5BE8C8] hover:shadow-[0_0_34px_rgba(79,227,193,0.4)]"
              >
                Open Adray GPT
                <ArrowUpRight className="ml-2 h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
