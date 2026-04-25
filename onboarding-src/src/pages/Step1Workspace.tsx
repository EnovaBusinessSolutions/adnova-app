import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { OnboardingLayout } from "@/layouts/OnboardingLayout";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_ICONS,
  INDUSTRY_VERTICALS,
  deriveSlug,
  isValidSlugFormat,
  type WorkspaceIconKey,
  type IndustryVertical,
} from "@/config/workspaceCatalogs";

type CreateWorkspacePayload = {
  name: string;
  slug?: string;
  icon?: WorkspaceIconKey;
  industryVertical?: IndustryVertical;
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
  const [industry, setIndustry] = useState<IndustryVertical | "">("");
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
        setError("Este nombre ya está en uso. Prueba con otro o ajusta el slug.");
      } else if (code === "SLUG_INVALID" || code === "SLUG_RESERVED" || code === "SLUG_TOO_LONG") {
        setError("El slug no es válido. Usa minúsculas, números y guiones.");
      } else if (code === "NAME_REQUIRED") {
        setError("El nombre es obligatorio.");
      } else if (code === "NAME_TOO_LONG") {
        setError("El nombre debe tener máximo 64 caracteres.");
      } else {
        setError("No pudimos crear el workspace. Intenta de nuevo.");
      }
    },
  });

  const canSubmit =
    name.trim().length >= 1 &&
    name.trim().length <= 64 &&
    isValidSlugFormat(slug) &&
    industry !== "";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate({
      name: name.trim(),
      slug,
      icon,
      industryVertical: industry as IndustryVertical,
    });
  }

  return (
    <OnboardingLayout currentStep={1}>
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-widest text-accent">Paso 1 de 3</div>
        <h1 className="text-3xl font-semibold">Configura tu workspace</h1>
        <p className="text-sm text-white/60">
          Un workspace es el espacio compartido donde tu equipo verá la inteligencia de
          marketing de tu marca. Dale un nombre, un ícono y dinos a qué te dedicas.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-widest text-white/50">
            Nombre del workspace
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Shogun, Gymshark, Pela Case"
            maxLength={64}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          {slug && (
            <div className="text-xs text-white/40">
              adray.ai/<span className="text-accent">{slug || "tu-workspace"}</span>
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
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 font-mono text-sm text-white placeholder:text-white/30 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          {slug && !isValidSlugFormat(slug) && (
            <div className="text-xs text-amber-400">
              Solo minúsculas, números y guiones. No puede empezar ni terminar con guión.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-widest text-white/50">Ícono</label>
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
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20"
                )}
              >
                <Icon className="h-5 w-5" />
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-widest text-white/50">
            Vertical de industria
          </label>
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value as IndustryVertical)}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            <option value="" disabled>Selecciona tu vertical…</option>
            {INDUSTRY_VERTICALS.map((v) => (
              <option key={v.key} value={v.key}>{v.label}</option>
            ))}
          </select>
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
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? "Creando…" : "Continuar →"}
          </button>
        </div>
      </form>
    </OnboardingLayout>
  );
}
