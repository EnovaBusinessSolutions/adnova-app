import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  ArrowLeft,
  Copy,
  Link2,
  Loader2,
  Sparkles,
  CheckCircle2,
  ArrowUpRight,
  Wand2,
  Share2,
  Trash2,
  AlertTriangle,
} from "lucide-react";

type LinkResponse = {
  ok?: boolean;
  data?: {
    provider?: string;
    shareToken?: string | null;
    shareUrl?: string | null;
    shareShortUrl?: string | null;
    shareApiUrl?: string | null;
    shareVersionedUrl?: string | null;
    shareVersion?: string | null;
    shareSnapshotId?: string | null;
    enabled?: boolean;
    created?: boolean;
    createdAt?: string | null;
    lastGeneratedAt?: string | null;
    revokedAt?: string | null;
  };
};

type DeleteLinkResponse = {
  ok?: boolean;
  data?: {
    revoked?: boolean;
    hadActiveLink?: boolean;
    dataPreserved?: boolean;
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

function isProbablyMobile() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || navigator.vendor || "";
  return /android|iphone|ipad|ipod|mobile/i.test(ua);
}

async function safeCopy(text: string) {
  if (!text) return false;

  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.padding = "0";
    ta.style.border = "0";
    ta.style.outline = "0";
    ta.style.boxShadow = "none";
    ta.style.background = "transparent";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";

    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);

    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function safeShare(title: string, text: string, url?: string) {
  try {
    if (!navigator.share) return false;
    await navigator.share({
      title,
      text,
      url,
    });
    return true;
  } catch {
    return false;
  }
}

function ConfirmDeleteModal({
  open,
  loading,
  onClose,
  onConfirm,
}: {
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!loading && !next) onClose();
      }}
    >
      <DialogContent className="border border-white/10 bg-[#101115] text-white sm:max-w-lg">
        <div className="absolute inset-0 opacity-70 pointer-events-none">
          <div className="absolute -top-16 right-0 h-56 w-56 rounded-full blur-3xl bg-red-500/10" />
          <div className="absolute -bottom-16 left-0 h-56 w-56 rounded-full blur-3xl bg-[#B55CFF]/10" />
        </div>

        <div className="relative">
          <DialogHeader>
            <div className="mb-4 flex items-start gap-4">
              <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-red-400/20 bg-red-400/10">
                <AlertTriangle className="h-5 w-5 text-red-300" />
              </div>

              <div>
                <DialogTitle className="text-xl font-bold text-white/95">
                  Delete your Adray AI link?
                </DialogTitle>
                <DialogDescription className="mt-3 text-sm leading-7 text-white/65">
                  This will immediately disable access through your current shared link.
                  Your connected data and AI context will not be deleted.
                  You can generate a new secure link at any time.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <DialogFooter className="mt-6 flex flex-wrap justify-end gap-3 sm:justify-end">
            <Button
              onClick={onClose}
              disabled={loading}
              className="h-11 rounded-2xl bg-white/[0.05] hover:bg-white/[0.08] text-white border border-white/10"
            >
              Cancel
            </Button>

            <Button
              onClick={onConfirm}
              disabled={loading}
              className="h-11 rounded-2xl bg-red-500 hover:bg-red-400 text-white"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {loading ? "Deleting..." : "Delete link"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
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
    <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-5 transition-all hover:border-[#4FE3C1]/30 hover:bg-white/[0.03] hover:shadow-[0_0_32px_rgba(79,227,193,0.08)]">
      <div className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="absolute -top-16 right-0 h-44 w-44 rounded-full blur-3xl bg-[#4FE3C1]/10" />
        <div className="absolute -bottom-16 left-0 h-40 w-40 rounded-full blur-3xl bg-[#B55CFF]/10" />
      </div>

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#4FE3C1]/20 bg-[#4FE3C1]/10 px-2.5 py-1 text-[11px] font-medium text-[#C9FFF3]">
              <Sparkles className="h-3.5 w-3.5" />
              Prompt {index}
            </div>

            <h3 className="mt-3 text-lg font-semibold text-white/95">{title}</h3>
          </div>

          <Button
            onClick={() => onCopy(prompt)}
            className="bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/10 shrink-0"
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

export default function ChatGptMcp() {
  const nav = useNavigate();

  const [shareUrl, setShareUrl] = useState("");
  const [chatGptReadyUrl, setChatGptReadyUrl] = useState("");
  const [hasActiveLink, setHasActiveLink] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingLink, setLoadingLink] = useState(false);
  const [copyingLink, setCopyingLink] = useState(false);
  const [sharingLink, setSharingLink] = useState(false);
  const [deletingLink, setDeletingLink] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (text: string) => {
    setToast(text);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1800);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const loadCurrentLink = async () => {
    try {
      setInitialLoading(true);
      setError(null);

      const json = await apiJson<LinkResponse>("/api/mcp/context/link", {
        method: "GET",
      });

      const enabled = !!json?.data?.enabled;
      const shortUrl = String(json?.data?.shareShortUrl || "").trim();
      const longUrl = String(json?.data?.shareUrl || "").trim();
      const stableUrl = shortUrl || longUrl;
      const versionedUrl = String(json?.data?.shareVersionedUrl || "").trim();

      setHasActiveLink(enabled && !!stableUrl);
      setShareUrl(enabled ? stableUrl : "");
      setChatGptReadyUrl(enabled ? versionedUrl : "");
    } catch (err: any) {
      setHasActiveLink(false);
      setShareUrl("");
      setChatGptReadyUrl("");

      if (String(err?.message || "").includes("MCP_ROOT_NOT_FOUND")) {
        setError("Your AI context is not ready yet.");
      } else {
        setError(null);
      }
    } finally {
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    loadCurrentLink();
  }, []);

  const generateFirstLink = async () => {
    try {
      setLoadingLink(true);
      setError(null);

      const json = await apiJson<LinkResponse>("/api/mcp/context/link", {
        method: "POST",
        body: JSON.stringify({
          provider: "chatgpt",
        }),
      });

      const shortUrl = String(json?.data?.shareShortUrl || "").trim();
      const longUrl = String(json?.data?.shareUrl || "").trim();
      const stableUrl = shortUrl || longUrl;
      const versionedUrl = String(json?.data?.shareVersionedUrl || "").trim();
      const enabled = !!json?.data?.enabled;

      setShareUrl(stableUrl);
      setChatGptReadyUrl(versionedUrl);
      setHasActiveLink(enabled && !!stableUrl);

      if (!stableUrl) {
        await loadCurrentLink();
        showToast("Link generated");
        return;
      }

      await loadCurrentLink();

      const copied = await safeCopy(stableUrl);
      if (copied) {
        showToast(json?.data?.created ? "First link created and copied" : "Link copied");
      } else if (isProbablyMobile() && navigator.share) {
        const shared = await safeShare("Adray AI Link", "Here is my Adray AI link", stableUrl);
        showToast(shared ? "Link ready to share" : "Link generated");
      } else {
        showToast("Link generated");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to generate link");
      showToast("Could not generate link");
    } finally {
      setLoadingLink(false);
    }
  };

  const copyCurrentLink = async () => {
    if (!shareUrl) {
      showToast("Generate your link first");
      return;
    }

    try {
      setCopyingLink(true);
      const ok = await safeCopy(shareUrl);
      if (ok) {
        showToast("Link copied");
      } else {
        showToast("Press and hold to copy manually");
      }
    } finally {
      setCopyingLink(false);
    }
  };

  const shareCurrentLink = async () => {
    if (!shareUrl) {
      showToast("Generate your link first");
      return;
    }

    try {
      setSharingLink(true);

      const shared = await safeShare(
        "Adray AI Link",
        "Here is my Adray AI link",
        shareUrl
      );

      if (shared) {
        showToast("Link ready to share");
        return;
      }

      const copied = await safeCopy(shareUrl);
      showToast(copied ? "Link copied" : "Press and hold to copy manually");
    } finally {
      setSharingLink(false);
    }
  };

  const deleteCurrentLink = async () => {
    try {
      setDeletingLink(true);
      setError(null);

      await apiJson<DeleteLinkResponse>("/api/mcp/context/link", {
        method: "DELETE",
      });

      setShareUrl("");
      setChatGptReadyUrl("");
      setHasActiveLink(false);
      setDeleteModalOpen(false);
      showToast("Link deleted");

      await loadCurrentLink();
    } catch (err: any) {
      setError(err?.message || "Failed to delete link");
      showToast("Could not delete link");
    } finally {
      setDeletingLink(false);
    }
  };

  const copyPrompt = async (text: string) => {
    const finalUrl = chatGptReadyUrl || shareUrl;
    const finalText = finalUrl
      ? text.replace(/"User's Adray AI link here"/g, finalUrl)
      : text;

    const ok = await safeCopy(finalText);
    showToast(ok ? "Prompt copied" : "Could not copy prompt");
  };

  const prompts = useMemo(() => {
    const linkPlaceholder = `"User's Adray AI link here"`;

    return [
      {
        title: "Best ROI campaign analysis",
        prompt: `Please act as a senior paid media and growth analyst. I want you to analyze my Adray AI data link: ${linkPlaceholder}

Using the data in that link, identify which campaigns are delivering the best ROI or ROAS across Meta Ads, Google Ads, and any supporting GA4 signals.

Please structure your answer as follows:
1. Executive summary
2. Top-performing campaign by platform
3. Which campaign appears to be the strongest overall winner and why
4. Supporting metrics behind that conclusion
5. Any risks or caveats in the data
6. What I should do next to scale profitably without damaging efficiency

Be specific, business-oriented, and decision-focused. Avoid generic advice.`,
      },
      {
        title: "Budget reallocation and wasted spend review",
        prompt: `Please review my Adray AI marketing data using this link: ${linkPlaceholder}

I want you to identify:
- where I am likely wasting budget
- which campaigns, ad groups, or channels should have reduced spend
- which winners deserve more budget
- whether there are cross-channel mismatches between paid performance and GA4 behavior

Then give me a clear reallocation plan with:
1. What to reduce
2. What to scale
3. What to monitor before making changes
4. The reasoning behind each recommendation

Answer like a sharp performance marketing operator who is optimizing for profitability, efficiency, and smarter budget deployment.`,
      },
      {
        title: "Conversion bottleneck and funnel diagnosis",
        prompt: `Analyze my Adray AI data from this link: ${linkPlaceholder}

I want you to diagnose my biggest conversion bottlenecks across paid traffic and on-site behavior.

Please evaluate:
- whether traffic quality looks strong or weak
- if engagement signals suggest landing page friction
- where conversion rate appears to break down
- whether CPA is being hurt more by media inefficiency or by funnel inefficiency
- what the biggest blockers are to getting more conversions from the same spend

Then provide:
1. A root-cause diagnosis
2. The top 3 bottlenecks
3. The likely impact of each bottleneck
4. The highest-priority actions to fix them

Make the answer practical, analytical, and deeply tied to the data in the link.`,
      },
      {
        title: "CMO-style strategic growth recommendations",
        prompt: `Use my Adray AI data link as your source of truth: ${linkPlaceholder}

I want you to think like a high-level CMO and growth strategist. Based on the marketing data in that link, tell me:

1. What is working best right now
2. What is underperforming
3. What strategic growth opportunities I may be missing
4. Which channels or campaigns deserve more focus
5. What immediate actions I should take this week
6. What medium-term actions I should take over the next 30 days

I want an answer that combines performance marketing logic, growth strategy, and business judgment. Be direct, intelligent, and highly actionable.`,
      },
    ];
  }, []);

  const promptReadyUrl = chatGptReadyUrl || shareUrl;

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[#0B0B0D]">
        <div className="p-4 sm:p-6">
          <Card className="glass-effect border-[#2C2530] bg-[#0F1012] overflow-hidden">
            <div className="relative">
              <div className="absolute inset-0 opacity-60">
                <div className="absolute -top-24 -right-20 h-72 w-72 rounded-full blur-3xl bg-[#4FE3C1]/18" />
                <div className="absolute top-24 left-0 h-64 w-64 rounded-full blur-3xl bg-[#B55CFF]/12" />
                <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full blur-3xl bg-[#4FE3C1]/10" />
              </div>

              <CardContent className="relative p-4 sm:p-6">
                <style>{`
                  @keyframes softFloat {
                    0% { transform: translateY(0px); }
                    50% { transform: translateY(-10px); }
                    100% { transform: translateY(0px); }
                  }

                  @keyframes glowSweep {
                    0% { transform: translateX(-140%); opacity: 0; }
                    25% { opacity: .7; }
                    70% { opacity: .7; }
                    100% { transform: translateX(140%); opacity: 0; }
                  }

                  .chatgpt-hero-bg::before {
                    content: "";
                    position: absolute;
                    inset: -10%;
                    background:
                      radial-gradient(700px 260px at 12% 20%, rgba(79,227,193,0.18), transparent 60%),
                      radial-gradient(560px 220px at 85% 18%, rgba(181,92,255,0.12), transparent 60%),
                      radial-gradient(640px 240px at 50% 100%, rgba(255,255,255,0.05), transparent 65%);
                    animation: softFloat 7s ease-in-out infinite;
                  }

                  .chatgpt-hero-bg::after {
                    content: "";
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    left: -30%;
                    width: 30%;
                    background: linear-gradient(90deg, transparent, rgba(79,227,193,0.16), transparent);
                    animation: glowSweep 4.2s ease-in-out infinite;
                  }
                `}</style>

                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#4FE3C1]/20 bg-[#4FE3C1]/10">
                      <Sparkles className="h-5 w-5 text-[#4FE3C1]" />
                    </div>

                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                        AI Provider
                      </div>
                      <div className="text-xl font-bold text-white/95">ChatGPT MCP</div>
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

                <div className="mt-6 relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.02] p-6 sm:p-8 chatgpt-hero-bg">
                  <div className="relative z-10 max-w-4xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#4FE3C1]/20 bg-[#4FE3C1]/10 px-3 py-1 text-xs text-[#C8FFF2]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {hasActiveLink
                        ? "Your secure Adray AI link is active"
                        : "Ready to generate your first Adray AI link"}
                    </div>

                    <h1 className="mt-5 text-3xl sm:text-5xl font-extrabold tracking-tight text-white/95 leading-[1.05]">
                      Turn your Adray intelligence into a
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4FE3C1] via-white to-[#4FE3C1]">
                        {" "}ChatGPT-ready link
                      </span>
                    </h1>

                    <p className="mt-4 max-w-3xl text-sm sm:text-base leading-7 text-white/60">
                      Keep one stable premium secure link for your account while Adray automatically prepares
                      a fresh ChatGPT-ready version behind the scenes, so your AI can read the newest context
                      without forcing you to regenerate your link.
                    </p>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <Button
                        onClick={generateFirstLink}
                        disabled={loadingLink || initialLoading || hasActiveLink}
                        className="h-12 rounded-2xl bg-[#4FE3C1] px-5 text-black hover:bg-[#3FD2B1] shadow-[0_0_32px_rgba(79,227,193,0.20)] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loadingLink ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Link2 className="h-4 w-4 mr-2" />
                        )}
                        {loadingLink
                          ? "Generating link..."
                          : hasActiveLink
                            ? "Link already generated"
                            : "Generate first link"}
                      </Button>

                      <Button
                        onClick={copyCurrentLink}
                        disabled={!shareUrl || copyingLink || initialLoading}
                        className="h-12 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/10"
                      >
                        {copyingLink ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Copy className="h-4 w-4 mr-2" />
                        )}
                        Copy Link
                      </Button>

                      <Button
                        onClick={shareCurrentLink}
                        disabled={!shareUrl || sharingLink || initialLoading}
                        className="h-12 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/10"
                      >
                        {sharingLink ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Share2 className="h-4 w-4 mr-2" />
                        )}
                        Share Link
                      </Button>

                      <Button
                        onClick={() => setDeleteModalOpen(true)}
                        disabled={!shareUrl || deletingLink || initialLoading}
                        className="h-12 rounded-2xl bg-red-500/12 hover:bg-red-500/18 text-red-200 border border-red-400/20"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Link
                      </Button>

                      <Button
                        onClick={() => window.open("https://chatgpt.com", "_blank", "noopener,noreferrer")}
                        className="h-12 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/10"
                      >
                        Open ChatGPT
                        <ArrowUpRight className="h-4 w-4 ml-2" />
                      </Button>
                    </div>

                    <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-white/82">
                        <Wand2 className="h-4 w-4 text-[#4FE3C1]" />
                        Your secure Adray AI link
                      </div>

                      <textarea
                        readOnly
                        value={
                          initialLoading
                            ? "Loading your current secure link..."
                            : shareUrl || "Generate your first secure link to unlock your Adray URL."
                        }
                        className="mt-3 min-h-[110px] w-full resize-none rounded-xl border border-white/10 bg-[#090A0D] px-4 py-3 text-sm text-white/70 outline-none"
                        onFocus={(e) => {
                          e.currentTarget.select();
                          e.currentTarget.setSelectionRange(0, e.currentTarget.value.length);
                        }}
                      />

                      <p className="mt-3 text-xs leading-6 text-white/42">
                        This link stays stable until you delete it. Adray keeps the latest context updated behind the same experience, so you do not need to regenerate it manually.
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
                      prompt={
                        promptReadyUrl
                          ? item.prompt.replace(/"User's Adray AI link here"/g, promptReadyUrl)
                          : item.prompt
                      }
                      onCopy={copyPrompt}
                    />
                  ))}
                </div>

                {toast ? (
                  <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-[60]">
                    <div className="rounded-full border border-white/10 bg-black/75 px-4 py-2 text-xs text-white/90 shadow-[0_0_28px_rgba(79,227,193,0.18)]">
                      {toast}
                    </div>
                  </div>
                ) : null}

                <ConfirmDeleteModal
                  open={deleteModalOpen}
                  loading={deletingLink}
                  onClose={() => {
                    if (!deletingLink) setDeleteModalOpen(false);
                  }}
                  onConfirm={deleteCurrentLink}
                />
              </CardContent>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}