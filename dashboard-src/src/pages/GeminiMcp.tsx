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
    <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-5 transition-all hover:border-[#A7D6FF]/30 hover:bg-white/[0.03] hover:shadow-[0_0_32px_rgba(167,214,255,0.09)]">
      <div className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="absolute -top-16 right-0 h-44 w-44 rounded-full blur-3xl bg-[#A7D6FF]/10" />
        <div className="absolute -bottom-16 left-0 h-40 w-40 rounded-full blur-3xl bg-[#B55CFF]/10" />
      </div>

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#A7D6FF]/20 bg-[#A7D6FF]/10 px-2.5 py-1 text-[11px] font-medium text-[#E1F2FF]">
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

export default function GeminiMcp() {
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
          provider: "gemini",
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
        title: "Fast executive performance breakdown",
        prompt: `Use my Adray AI data link as the source of truth: ${linkPlaceholder}

Please give me a structured and concise executive breakdown of my marketing performance across Meta Ads, Google Ads, and GA4.

I want you to clearly summarize:
1. What is performing best
2. What is performing worst
3. The main business risks
4. The top opportunities
5. The 3 most important actions I should take next

Keep the answer smart, highly structured, and easy to act on. Avoid unnecessary filler.`,
      },
      {
        title: "Cross-channel winner vs loser analysis",
        prompt: `Please analyze my Adray AI marketing data using this link: ${linkPlaceholder}

I want you to compare the strongest and weakest parts of my marketing mix across channels.

Please identify:
- the top-performing campaigns or channel segments
- the weakest-performing campaigns or channel segments
- where ROI or ROAS looks strongest
- where spend looks inefficient
- whether GA4 behavior supports or contradicts paid media performance

Then provide:
1. Best performers
2. Weakest performers
3. Key supporting evidence
4. Clear recommendations on what to scale, cut, or fix

Please respond in a very structured, clean, decision-oriented format.`,
      },
      {
        title: "Performance optimization action plan",
        prompt: `Review my Adray AI data from this link: ${linkPlaceholder}

I want a practical optimization plan based on the actual data in that link.

Please tell me:
- what I should optimize first
- what I should not touch yet
- which campaigns or channels deserve more budget
- which elements likely need creative, funnel, or budget adjustments
- which metrics matter most right now

Then build a prioritized plan with:
1. Immediate quick wins
2. Medium-priority optimizations
3. Strategic follow-up actions
4. What to monitor after making changes

Be clear, practical, and focused on improving real performance outcomes.`,
      },
      {
        title: "Marketing intelligence summary for decision-making",
        prompt: `Use this Adray AI link as my data source: ${linkPlaceholder}

I want you to act like a sharp marketing intelligence assistant and help me extract the most important decisions from the data.

Please provide:
1. The most important insights from the link
2. The strongest signs of profitable growth
3. The clearest inefficiencies or warning signs
4. What this means for my business right now
5. The next best decisions I should make this week

Please keep your answer precise, well-organized, and useful for quick executive decision-making.`,
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
                <div className="absolute -top-24 -right-20 h-72 w-72 rounded-full blur-3xl bg-[#A7D6FF]/18" />
                <div className="absolute top-24 left-0 h-64 w-64 rounded-full blur-3xl bg-[#B55CFF]/10" />
                <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full blur-3xl bg-[#A7D6FF]/10" />
              </div>

              <CardContent className="relative p-4 sm:p-6">
                <style>{`
                  @keyframes softFloatGemini {
                    0% { transform: translateY(0px); }
                    50% { transform: translateY(-10px); }
                    100% { transform: translateY(0px); }
                  }

                  @keyframes glowSweepGemini {
                    0% { transform: translateX(-140%); opacity: 0; }
                    25% { opacity: .7; }
                    70% { opacity: .7; }
                    100% { transform: translateX(140%); opacity: 0; }
                  }

                  .gemini-hero-bg::before {
                    content: "";
                    position: absolute;
                    inset: -10%;
                    background:
                      radial-gradient(700px 260px at 12% 20%, rgba(167,214,255,0.18), transparent 60%),
                      radial-gradient(560px 220px at 85% 18%, rgba(181,92,255,0.12), transparent 60%),
                      radial-gradient(640px 240px at 50% 100%, rgba(255,255,255,0.05), transparent 65%);
                    animation: softFloatGemini 7s ease-in-out infinite;
                  }

                  .gemini-hero-bg::after {
                    content: "";
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    left: -30%;
                    width: 30%;
                    background: linear-gradient(90deg, transparent, rgba(167,214,255,0.16), transparent);
                    animation: glowSweepGemini 4.2s ease-in-out infinite;
                  }
                `}</style>

                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#A7D6FF]/20 bg-[#A7D6FF]/10">
                      <Sparkles className="h-5 w-5 text-[#A7D6FF]" />
                    </div>

                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                        AI Provider
                      </div>
                      <div className="text-xl font-bold text-white/95">Gemini MCP</div>
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

                <div className="mt-6 relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.02] p-6 sm:p-8 gemini-hero-bg">
                  <div className="relative z-10 max-w-4xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#A7D6FF]/20 bg-[#A7D6FF]/10 px-3 py-1 text-xs text-[#E1F2FF]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Ready to generate your Adray AI link
                    </div>

                    <h1 className="mt-5 text-3xl sm:text-5xl font-extrabold tracking-tight text-white/95 leading-[1.05]">
                      Turn your Adray intelligence into a
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#A7D6FF] via-white to-[#A7D6FF]">
                        {" "}Gemini-ready link
                      </span>
                    </h1>

                    <p className="mt-4 max-w-3xl text-sm sm:text-base leading-7 text-white/60">
                      Generate one premium link powered by your encoded Adray AI context, then paste it into the prompts
                      below so Gemini can give you faster, cleaner, and more structured marketing insights with stronger context.
                    </p>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <Button
                        onClick={createAndCopyLink}
                        disabled={loadingLink}
                        className="h-12 rounded-2xl bg-[#A7D6FF] px-5 text-black hover:bg-[#95CAFA] shadow-[0_0_32px_rgba(167,214,255,0.18)]"
                      >
                        {loadingLink ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Link2 className="h-4 w-4 mr-2" />
                        )}
                        {loadingLink ? "Generating link..." : "Generate & Copy Link"}
                      </Button>

                      <Button
                        onClick={() => window.open("https://gemini.google.com", "_blank", "noopener,noreferrer")}
                        className="h-12 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/10"
                      >
                        Open Gemini
                        <ArrowUpRight className="h-4 w-4 ml-2" />
                      </Button>
                    </div>

                    <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-white/82">
                        <Wand2 className="h-4 w-4 text-[#A7D6FF]" />
                        Your generated Adray AI link
                      </div>

                      <div className="mt-3 break-all rounded-xl border border-white/10 bg-[#090A0D] px-4 py-3 text-sm text-white/60">
                        {shareUrl || "Generate your link to unlock your Gemini-ready Adray URL."}
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
                    <div className="rounded-full border border-white/10 bg-black/75 px-4 py-2 text-xs text-white/90 shadow-[0_0_28px_rgba(167,214,255,0.18)]">
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