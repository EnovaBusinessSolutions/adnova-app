import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { ParticleField } from '@/components/ParticleField';

type Workspace = { _id: string; name: string; role?: string };

export default function Success() {
  const [searchParams] = useSearchParams();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const teammatesCount = parseInt(searchParams.get('count') || '0', 10);

  useEffect(() => {
    fetch('/api/me/workspaces', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json && json.workspaces && json.workspaces.length > 0) {
          const sorted = [...json.workspaces].sort((a: any, b: any) =>
            String(b.createdAt).localeCompare(String(a.createdAt))
          );
          setWorkspace(sorted[0]);
        }
      })
      .catch(() => {});
  }, []);

  function goToDashboard() {
    window.location.href = '/dashboard';
  }

  return (
    <div className="adray-dashboard-shell adray-hero-bg relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="adray-hero-grid" aria-hidden="true" />
      <div className="adray-hero-beam" aria-hidden="true" />
      <ParticleField variant="multiverse" count={32} />

      <div className="relative z-10 mx-auto max-w-2xl px-6 py-24">
        <div className="flex flex-col items-center text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full border border-emerald-400/35 bg-gradient-to-br from-emerald-500/15 to-emerald-400/5 shadow-[0_0_36px_rgba(52,211,153,0.34),inset_0_1px_0_rgba(255,255,255,0.12)]">
            <Check className="h-9 w-9 text-emerald-300" />
          </div>
          <div className="mt-5 text-xs uppercase tracking-[0.22em] text-[#b55cff]">
            Workspace listo
          </div>
          <h1 className="gradient-text mt-2 text-3xl font-semibold">Todo está configurado</h1>
          <p className="mt-3 max-w-md text-sm text-muted-foreground">
            {teammatesCount > 0
              ? `Invitaciones enviadas. Conecta tus fuentes de datos para que Adray empiece a construir inteligencia de marketing.`
              : `Conecta tus fuentes de datos para que Adray empiece a construir inteligencia de marketing.`}
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="glass-effect rounded-2xl p-4">
            <div className="text-xs uppercase tracking-widest text-white/40">Workspace</div>
            <div className="mt-1 truncate text-base font-semibold text-foreground">
              {workspace?.name || '—'}
            </div>
          </div>
          <div className="glass-effect rounded-2xl p-4">
            <div className="text-xs uppercase tracking-widest text-white/40">Tu rol</div>
            <div className="mt-1 text-base font-semibold text-foreground">
              {workspace?.role || 'Owner'}
            </div>
          </div>
          <div className="glass-effect rounded-2xl p-4">
            <div className="text-xs uppercase tracking-widest text-white/40">Compañeros</div>
            <div className="mt-1 text-base font-semibold text-foreground">
              {teammatesCount > 0 ? teammatesCount : '—'}
            </div>
          </div>
        </div>

        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={goToDashboard}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#b55cff] to-[#9b7cff] px-6 py-3 text-sm font-semibold text-white shadow-[0_0_22px_rgba(181,92,255,0.34)] transition-all duration-300 hover:shadow-[0_0_36px_rgba(181,92,255,0.52)] hover:-translate-y-0.5"
          >
            Continuar al dashboard →
          </button>
        </div>
      </div>
    </div>
  );
}
