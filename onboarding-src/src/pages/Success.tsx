import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';

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
    <div className="min-h-screen bg-bg text-white">
      <div className="mx-auto max-w-2xl px-6 py-24">
        <div className="flex flex-col items-center text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
            <Check className="h-7 w-7 text-emerald-400" />
          </div>
          <div className="mt-5 text-xs uppercase tracking-widest text-accent">
            Workspace listo
          </div>
          <h1 className="mt-2 text-3xl font-semibold">Todo está configurado</h1>
          <p className="mt-3 max-w-md text-sm text-white/60">
            {teammatesCount > 0
              ? `Invitaciones enviadas. Conecta tus fuentes de datos para que Adray empiece a construir inteligencia de marketing.`
              : `Conecta tus fuentes de datos para que Adray empiece a construir inteligencia de marketing.`}
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-widest text-white/40">Workspace</div>
            <div className="mt-1 truncate text-base font-semibold text-white">
              {workspace?.name || '—'}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-widest text-white/40">Tu rol</div>
            <div className="mt-1 text-base font-semibold text-white">
              {workspace?.role || 'Owner'}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-widest text-white/40">Compañeros</div>
            <div className="mt-1 text-base font-semibold text-white">
              {teammatesCount > 0 ? teammatesCount : '—'}
            </div>
          </div>
        </div>

        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={goToDashboard}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white transition hover:bg-accent-hover"
          >
            Continuar al dashboard →
          </button>
        </div>
      </div>
    </div>
  );
}
