import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  ICON_OPTIONS_FULL, getWorkspaceIcon, INDUSTRY_VERTICALS, deriveSlug,
  isValidSlugFormat, type IndustryVertical,
} from "@/config/workspaceCatalogs";

async function postWorkspace(payload: any) {
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

const ERR_MESSAGES: Record<string, string> = {
  NAME_REQUIRED: "El nombre es requerido.",
  NAME_TOO_LONG: "El nombre debe tener máximo 64 caracteres.",
  SLUG_INVALID: "El slug no es válido.",
  SLUG_TAKEN: "Este slug ya está en uso.",
  SLUG_RESERVED: "Este slug está reservado.",
};

export function CreateWorkspaceModal({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { switchWorkspace, refresh } = useWorkspace();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [icon, setIcon] = useState("SHOPPING_BAG");
  const [industry, setIndustry] = useState<IndustryVertical | "">("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slugTouched) setSlug(deriveSlug(name));
  }, [name, slugTouched]);

  function reset() {
    setName(""); setSlug(""); setSlugTouched(false);
    setIcon("SHOPPING_BAG"); setIndustry(""); setError(null);
  }

  const mutation = useMutation({
    mutationFn: postWorkspace,
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ["me", "workspaces"] });
      toast.success(`Workspace "${data.workspace.name}" creado`);
      await refresh();
      try { await switchWorkspace(data.workspace._id); } catch {}
      reset();
      onOpenChange(false);
      navigate("/workspaces");
    },
    onError: (err: any) => {
      const code = err?.code;
      setError(ERR_MESSAGES[code] || "No se pudo crear el workspace.");
    },
  });

  const canSubmit =
    name.trim().length >= 1 && name.trim().length <= 64 &&
    isValidSlugFormat(slug) && industry !== "";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate({
      name: name.trim(),
      slug,
      icon,
      industryVertical: industry,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg border-white/10 bg-[#0B0B0D] text-white">
        <DialogHeader>
          <DialogTitle>Crear nuevo workspace</DialogTitle>
          <DialogDescription className="text-white/60">
            Un workspace nuevo significa un espacio separado con sus propias conexiones e inteligencia.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-white/70">Nombre</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              placeholder="Ej. Mi otra tienda"
              className="border-white/10 bg-white/[0.04] text-white"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label className="text-white/70">Slug (URL)</Label>
            <Input
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/\s/g, "-")); }}
              maxLength={48}
              className="border-white/10 bg-white/[0.04] font-mono text-sm text-white"
            />
            {slug && !isValidSlugFormat(slug) && (
              <p className="text-xs text-amber-400">Solo minúsculas, números y guiones.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-white/70">Ícono</Label>
            <div className="grid grid-cols-8 gap-2">
              {ICON_OPTIONS_FULL.map((o) => {
                const Icon = getWorkspaceIcon(o.key);
                const sel = icon === o.key;
                return (
                  <button
                    type="button"
                    key={o.key}
                    onClick={() => setIcon(o.key)}
                    className={[
                      "flex aspect-square items-center justify-center rounded-xl border transition",
                      sel ? "border-[#B55CFF] bg-[#B55CFF]/15 text-[#B55CFF]" : "border-white/10 bg-white/[0.03] text-white/60",
                    ].join(" ")}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-white/70">Vertical</Label>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value as IndustryVertical)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white"
            >
              <option value="" disabled>Selecciona…</option>
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-white/10 bg-white/[0.04] text-white"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || mutation.isPending}
              className="bg-[#B55CFF] text-white hover:bg-[#A664FF]"
            >
              {mutation.isPending ? "Creando…" : "Crear workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
