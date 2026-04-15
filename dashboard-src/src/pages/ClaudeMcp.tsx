import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import {
  ArrowLeft,
  Copy,
  Link2,
  Loader2,
  Sparkles,
  CheckCircle2,
  ArrowUpRight,
  Wand2,
} from "lucide-react";

type LinkResponse = {
  ok?: boolean;
  data?: {
    provider?: string;
    shareToken?: string | null;
    shareUrl?: string | null;
    enabled?: boolean;
  };
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

async function safeCopy(text: string) {
  if (!text) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // noop
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function PromptCard({
  index,
  title,
  prompt,
  onCopy,
}: {
  index: number;
  title: string;
  prompt: string;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-5 transition-all hover:border-[#D9C7FF]/30 hover:bg-white/[0.03] hover:shadow-[0_0_32px_rgba(217,199,255,0.09)]">
      <div className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="absolute -top-16 right-0 h-44 w-44 rounded-full blur-3xl bg-[#D9C7FF]/10" />
        <div className="absolute -bottom-16 left-0 h-40 w-40 rounded-full blur-3xl bg-[#B55CFF]/10" />
      </div>

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#D9C7FF]/20 bg-[#D9C7FF]/10 px-2.5 py-1 text-[11px] font-medium text-[#F2EAFE]">
              <Sparkles className="h-3.5 w-3.5" />
              Prompt {index}
            </div>

            <h3 className="mt-3 text-lg font-semibold text-white/95">{title}</h3>
          </div>

          <Button
            onClick={() => onCopy(prompt)}
            className="bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/10"
          >
            <Copy className="h-4 w-4 mr-2" />
            Copy
          </Button>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-[#090A0D] p-4">
          <pre className="whitespace-pre-wrap text-[12px] leading-6 text-white/78 font-mono">
            {prompt}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default function ClaudeMcp() {
  const nav = useNavigate();

  const [shareUrl, setShareUrl] = useState("");
  const [loadingLink, setLoadingLink] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 1600);
  };

  const createAndCopyLink = async () => {
    try {
      setLoadingLink(true);
      setError(null);

      const json = await apiJson<LinkResponse>("/api/mcp/context/link", {
        method: "POST",
        body: JSON.stringify({
          provider: "claude",
          regenerate: false,
        }),
      });

      const url = json?.data?.shareUrl || "";
      setShareUrl(url);

      const ok = await safeCopy(url);
      showToast(ok ? "Link copied" : "Link generated");
    } catch (err: any) {
      setError(err?.message || "Failed to generate link");
      showToast("Could not generate link");
    } finally {
      setLoadingLink(false);
    }
  };

  const copyPrompt = async (text: string) => {
    const ok = await safeCopy(text);
    showToast(ok ? "Prompt copied" : "Could not copy prompt");
  };

  const prompts = useMemo(() => {
    const linkPlaceholder = `"User's Adray AI link here"`;

    return [
      {
        title: "Deep strategic performance diagnosis",
        prompt: `Please act as a senior performance marketing strategist and business analyst. Use my Adray AI data link as the primary source of truth: ${linkPlaceholder}

I want a structured, deeply reasoned diagnosis of my current marketing performance across Meta Ads, Google Ads, and any relevant behavioral signals from GA4.

Please structure your answer into:
1. Executive summary
2. What appears to be working best
3. What appears to be underperforming
4. The most important cross-channel patterns or contradictions
5. Strategic implications for the business
6. Immediate recommendations
7. Medium-term recommendations

I want you to think carefully, explain your reasoning clearly, and prioritize strategic signal over generic advice.`,
      },
      {
        title: "Budget efficiency and scaling tradeoff analysis",
        prompt: `Please analyze my Adray AI data using this link: ${linkPlaceholder}

I want you to evaluate how I should think about budget efficiency versus scaling opportunities.

Specifically, please determine:
- which campaigns or channels seem most efficient
- which ones appear scalable
- where scaling might damage performance
- where I may be underinvesting in strong winners
- where I may be protecting weak campaigns for too long

Then provide a strategic recommendation framework with:
1. What to keep stable
2. What to scale carefully
3. What to cut or reduce
4. The tradeoffs behind those decisions
5. What I should monitor as I make budget changes

Answer with high clarity, structured thinking, and strong business judgment.`,
      },
      {
        title: "Conversion problem root-cause analysis",
        prompt: `Please use my Adray AI data link as your source of truth: ${linkPlaceholder}

I want a thoughtful root-cause analysis of why my conversion performance may be weaker than expected.

Please assess:
- whether the issue appears to be traffic quality
- whether the issue appears to be funnel or landing page friction
- whether the issue appears to be budget misallocation
- whether there are signs of misalignment between paid media and on-site behavior
- which bottlenecks are most likely hurting business outcomes

Then explain:
1. The most likely root cause
2. The second-order contributing factors
3. Which signals from the data support your conclusion
4. What actions would most likely improve conversion performance

Please be analytical, careful, and explicit in your reasoning.`,
      },
      {
        title: "Executive decision memo for next moves",
        prompt: `I want you to act like a strategic advisor preparing a decision memo for leadership. Use my Adray AI link here: ${linkPlaceholder}

Based on the data in that link, write a concise but high-quality strategic memo covering:
1. Current marketing situation
2. Strongest opportunities
3. Biggest risks
4. Where leadership attention is needed most
5. What should be done in the next 7 days
6. What should be done in the next 30 days

Please write with clarity, strategic depth, and executive-level precision. The answer should help a founder, operator, or CMO make better decisions quickly.`,
      },
    ];
  }, []);

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[#0B0B0D]">
        <div className="p-4 sm:p-6">
          <Card className="glass-effect border-[#2C2530] bg-[#0F1012] overflow-hidden">
            <div className="relative">
              <div className="absolute inset-0 opacity-60">
                <div className="absolute -top-24 -right-20 h-72 w-72 rounded-full blur-3xl bg-[#D9C7FF]/18" />
                <div className="absolute top-24 left-0 h-64 w-64 rounded-full blur-3xl bg-[#B55CFF]/10" />
                <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full blur-3xl bg-[#D9C7FF]/10" />
              </div>

              <CardContent className="relative p-4 sm:p-6">
                <style>{`
                  @keyframes softFloatClaude {
                    0% { transform: translateY(0px); }
                    50% { transform: translateY(-10px); }
                    100% { transform: translateY(0px); }
                  }

                  @keyframes glowSweepClaude {
                    0% { transform: translateX(-140%); opacity: 0; }
                    25% { opacity: .7; }
                    70% { opacity: .7; }
                    100% { transform: translateX(140%); opacity: 0; }
                  }

                  .claude-hero-bg::before {
                    content: "";
                    position: absolute;
                    inset: -10%;
                    background:
                      radial-gradient(700px 260px at 12% 20%, rgba(217,199,255,0.18), transparent 60%),
                      radial-gradient(560px 220px at 85% 18%, rgba(181,92,255,0.12), transparent 60%),
                      radial-gradient(640px 240px at 50% 100%, rgba(255,255,255,0.05), transparent 65%);
                    animation: softFloatClaude 7s ease-in-out infinite;
                  }

                  .claude-hero-bg::after {
                    content: "";
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    left: -30%;
                    width: 30%;
                    background: linear-gradient(90deg, transparent, rgba(217,199,255,0.16), transparent);
                    animation: glowSweepClaude 4.2s ease-in-out infinite;
                  }
                `}</style>

                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#D9C7FF]/20 bg-[#D9C7FF]/10">
                      <Sparkles className="h-5 w-5 text-[#D9C7FF]" />
                    </div>

                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                        AI Provider
                      </div>
                      <div className="text-xl font-bold text-white/95">Claude MCP</div>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    onClick={() => nav("/laststep")}
                    className="text-white/80 hover:bg-white/[0.06]"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                </div>

                <div className="mt-6 relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.02] p-6 sm:p-8 claude-hero-bg">
                  <div className="relative z-10 max-w-4xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#D9C7FF]/20 bg-[#D9C7FF]/10 px-3 py-1 text-xs text-[#F2EAFE]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Ready to generate your Adray AI link
                    </div>

                    <h1 className="mt-5 text-3xl sm:text-5xl font-extrabold tracking-tight text-white/95 leading-[1.05]">
                      Turn your Adray intelligence into a
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#D9C7FF] via-white to-[#D9C7FF]">
                        {" "}Claude-ready link
                      </span>
                    </h1>

                    <p className="mt-4 max-w-3xl text-sm sm:text-base leading-7 text-white/60">
                      Generate one premium link powered by your encoded Adray AI context, then paste it into the prompts
                      below so Claude can reason more deeply about your marketing performance, strategic tradeoffs,
                      and business opportunities.
                    </p>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <Button
                        onClick={createAndCopyLink}
                        disabled={loadingLink}
                        className="h-12 rounded-2xl bg-[#D9C7FF] px-5 text-black hover:bg-[#C9B2FF] shadow-[0_0_32px_rgba(217,199,255,0.18)]"
                      >
                        {loadingLink ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Link2 className="h-4 w-4 mr-2" />
                        )}
                        {loadingLink ? "Generating link..." : "Generate & Copy Link"}
                      </Button>

                      <Button
                        onClick={() => window.open("https://claude.ai", "_blank", "noopener,noreferrer")}
                        className="h-12 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/10"
                      >
                        Open Claude
                        <ArrowUpRight className="h-4 w-4 ml-2" />
                      </Button>
                    </div>

                    <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-white/82">
                        <Wand2 className="h-4 w-4 text-[#D9C7FF]" />
                        Your generated Adray AI link
                      </div>

                      <div className="mt-3 break-all rounded-xl border border-white/10 bg-[#090A0D] px-4 py-3 text-sm text-white/60">
                        {shareUrl || "Generate your link to unlock your Claude-ready Adray URL."}
                      </div>

                      <p className="mt-3 text-xs leading-6 text-white/42">
                        In the prompts below, replace{" "}
                        <span className="text-white/70 font-medium">"User's Adray AI link here"</span>{" "}
                        with the exact link we generate for you.
                      </p>
                    </div>
                  </div>
                </div>

                {error ? (
                  <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200/90">
                    {error}
                  </div>
                ) : null}

                <div className="mt-6 grid grid-cols-1 gap-4">
                  {prompts.map((item, idx) => (
                    <PromptCard
                      key={item.title}
                      index={idx + 1}
                      title={item.title}
                      prompt={item.prompt}
                      onCopy={copyPrompt}
                    />
                  ))}
                </div>

                {toast ? (
                  <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-[60]">
                    <div className="rounded-full border border-white/10 bg-black/75 px-4 py-2 text-xs text-white/90 shadow-[0_0_28px_rgba(217,199,255,0.18)]">
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