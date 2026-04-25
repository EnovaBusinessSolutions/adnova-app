import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { OnboardingLayout } from "@/layouts/OnboardingLayout";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_ICONS,
  deriveSlug,
  isValidSlugFormat,
  type WorkspaceIconKey,
} from "@/config/workspaceCatalogs";

type CreateWorkspacePayload = {
  name: string;
  slug?: string;
  icon?: WorkspaceIconKey;
};

async function createWorkspace(payload: CreateWorkspacePayload) {
  const res = await fetch("/api/workspaces", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    (err as any).code = json.error;
    throw err;
  }
  return json;
}

export default function Step1Workspace() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [icon, setIcon] = useState<WorkspaceIconKey>("SHOPPING_BAG");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slugTouched) setSlug(deriveSlug(name));
  }, [name, slugTouched]);

  const mutation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: async () => {
      // Marcar onboardingStep para reanudación.
      try {
        await fetch('/api/me/profile', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ onboardingStep: 'WORKSPACE_CREATED' }),
        });
      } catch (e) {
        // No bloquear el flujo si esto falla; el dashboard se encarga.
      }
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['active-workspace'] });
      navigate('/profile');
    },
    onError: (err: any) => {
      const code = err?.code;
      if (code === "SLUG_TAKEN") {
        setError("This name is already in use. Try another one or adjust the slug.");
      } else if (code === "SLUG_INVALID" || code === "SLUG_RESERVED" || code === "SLUG_TOO_LONG") {
        setError("Invalid slug. Use lowercase, numbers, and hyphens.");
      } else if (code === "NAME_REQUIRED") {
        setError("Name is required.");
      } else if (code === "NAME_TOO_LONG") {
        setError("Name must be 64 characters or fewer.");
      } else {
        setError("We couldn't create the workspace. Try again.");
      }
    },
  });

  const canSubmit =
    name.trim().length >= 1 &&
    name.trim().length <= 64 &&
    isValidSlugFormat(slug);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate({
      name: name.trim(),
      slug,
      icon,
    });
  }

  return (
    <OnboardingLayout currentStep={1}>
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-[0.22em] text-[#b55cff]">Step 1 of 3</div>
        <h1 className="gradient-text text-3xl font-semibold leading-tight">Set up your workspace</h1>
        <p className="text-sm text-muted-foreground">
          A workspace is the shared space where your team will see your brand's marketing
          intelligence. Give it a name, an icon, and tell us what you do.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-widest text-white/50">
            Workspace name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Shogun, Gymshark, Pela Case"
            maxLength={64}
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl px-4 py-3 text-foreground placeholder:text-white/30 transition-all duration-200 hover:border-white/[0.14] focus:border-[#b55cff]/55 focus:outline-none focus:ring-2 focus:ring-[#b55cff]/22 focus:shadow-[0_0_28px_rgba(181,92,255,0.18)]"
          />
          {slug && (
            <div className="text-xs text-white/40">
              adray.ai/<span className="text-[#b55cff]">{slug || "tu-workspace"}</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-widest text-white/50">Slug (URL)</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase().replace(/\s/g, "-"));
            }}
            maxLength={48}
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl px-4 py-3 font-mono text-sm text-foreground placeholder:text-white/30 transition-all duration-200 hover:border-white/[0.14] focus:border-[#b55cff]/55 focus:outline-none focus:ring-2 focus:ring-[#b55cff]/22 focus:shadow-[0_0_28px_rgba(181,92,255,0.18)]"
          />
          {slug && !isValidSlugFormat(slug) && (
            <div className="text-xs text-amber-400">
              Only lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-widest text-white/50">Icon</label>
          <div className="grid grid-cols-8 gap-2">
            {WORKSPACE_ICONS.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setIcon(key)}
                title={label}
                className={cn(
                  "aspect-square rounded-xl border flex items-center justify-center transition",
                  icon === key
                    ? "border-[#b55cff] bg-[rgba(181,92,255,0.15)] text-[#b55cff] neon-glow"
                    : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20"
                )}
              >
                <Icon className="h-5 w-5" />
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={!canSubmit || mutation.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#b55cff] to-[#9b7cff] px-6 py-3 text-sm font-semibold text-white shadow-[0_0_22px_rgba(181,92,255,0.34)] transition-all duration-300 hover:shadow-[0_0_36px_rgba(181,92,255,0.52)] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {mutation.isPending ? "Creating…" : "Continue →"}
          </button>
        </div>
      </form>
    </OnboardingLayout>
  );
}
