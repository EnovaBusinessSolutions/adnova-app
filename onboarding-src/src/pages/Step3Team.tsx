import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, X, Crown } from 'lucide-react';
import { OnboardingLayout } from '@/layouts/OnboardingLayout';
import { PremiumSelect } from '@/components/PremiumSelect';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useUpdateProfile } from '@/hooks/useUpdateProfile';
import { INVITABLE_ROLES, isValidEmail } from '@/config/workspaceCatalogs';
import { cn } from '@/lib/utils';

type InviteRow = {
  email: string;
  role: 'ADMIN' | 'MEMBER';
};

type WorkspaceListItem = { _id: string; name: string; role: string };

async function fetchActiveWorkspace(): Promise<WorkspaceListItem | null> {
  const res = await fetch('/api/me/workspaces', { credentials: 'include' });
  if (!res.ok) return null;
  const json = await res.json();
  const workspaces: WorkspaceListItem[] = json.workspaces || [];
  if (workspaces.length === 0) return null;
  if (json.activeWorkspaceId) {
    const found = workspaces.find((w) => w._id === json.activeWorkspaceId);
    if (found) return found;
  }
  return workspaces[0];
}

async function postInvitation(workspaceId: string, email: string, role: 'ADMIN' | 'MEMBER') {
  const res = await fetch(`/api/workspaces/${workspaceId}/invitations`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    (err as any).code = json.error;
    throw err;
  }
  return json;
}

export default function Step3Team() {
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const updateProfile = useUpdateProfile();

  const { data: workspace, isLoading: wsLoading } = useQuery({
    queryKey: ['active-workspace'],
    queryFn: fetchActiveWorkspace,
  });

  const [rows, setRows] = useState<InviteRow[]>([{ email: '', role: 'MEMBER' }]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  function addRow() {
    setRows((r) => [...r, { email: '', role: 'MEMBER' }]);
  }
  function removeRow(idx: number) {
    setRows((r) => r.filter((_, i) => i !== idx));
  }
  function updateRow(idx: number, patch: Partial<InviteRow>) {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  async function markComplete() {
    try {
      await updateProfile.mutateAsync({ onboardingStep: 'COMPLETE' });
    } catch (err) {
      // No bloquear navigation si falla; el dashboard puede manejarlo.
    }
  }

  async function handleSkip() {
    setError(null);
    await markComplete();
    navigate('/success?count=0');
  }

  async function handleSend() {
    setError(null);

    if (!workspace) {
      setError('No encontramos tu workspace. Recarga la página.');
      return;
    }

    const validRows = rows.filter((r) => r.email.trim().length > 0);
    if (validRows.length === 0) {
      await handleSkip();
      return;
    }

    for (const r of validRows) {
      if (!isValidEmail(r.email.trim())) {
        setError(`"${r.email}" no es un email válido.`);
        return;
      }
    }

    const lower = validRows.map((r) => r.email.trim().toLowerCase());
    const dup = lower.find((e, i) => lower.indexOf(e) !== i);
    if (dup) {
      setError(`El email "${dup}" está duplicado en la lista.`);
      return;
    }

    setSending(true);
    let sentCount = 0;
    const failures: { email: string; error: string }[] = [];

    for (const r of validRows) {
      try {
        await postInvitation(workspace._id, r.email.trim().toLowerCase(), r.role);
        sentCount++;
      } catch (err: any) {
        failures.push({ email: r.email, error: err?.code || 'UNKNOWN' });
      }
    }

    setSending(false);

    if (failures.length === validRows.length) {
      setError(
        `No pudimos enviar las invitaciones. Detalle: ${failures.map((f) => `${f.email} (${f.error})`).join(', ')}`
      );
      return;
    }

    if (failures.length > 0) {
      console.warn('Invitations failed:', failures);
    }

    await markComplete();
    navigate(`/success?count=${sentCount}`);
  }

  const ownerInitials = (() => {
    const f = (user?.firstName || '').trim();
    const l = (user?.lastName || '').trim();
    if (f && l) return (f[0] + l[0]).toUpperCase();
    if (f) return f.slice(0, 2).toUpperCase();
    if (l) return l.slice(0, 2).toUpperCase();
    if (user?.name) {
      const parts = user.name.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (user?.email?.[0] || '?').toUpperCase();
  })();
  const ownerDisplayName =
    user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.email || 'Owner';

  return (
    <OnboardingLayout currentStep={3}>
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-[0.22em] text-[#b55cff]">Paso 3 de 3</div>
        <h1 className="gradient-text text-3xl font-semibold leading-tight">Invita a tu equipo</h1>
        <p className="text-sm text-muted-foreground">
          Agrega compañeros que colaborarán en este workspace. Recibirán un email para aceptar.
          Puedes saltarte este paso e invitarlos después desde el panel de members.
        </p>
      </div>

      <div className="mt-8 space-y-3">
        {/* Owner card */}
        <div className="flex items-center justify-between rounded-2xl border border-[#b55cff]/25 bg-[rgba(181,92,255,0.06)] backdrop-blur-2xl px-4 py-3 shadow-[0_0_28px_rgba(181,92,255,0.10),inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#b55cff] via-[#9b7cff] to-[#7c6df0] text-sm font-semibold text-white">
              {ownerInitials}
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">{ownerDisplayName}</div>
              <div className="text-xs text-white/50">{user?.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-[rgba(181,92,255,0.15)] px-3 py-1 text-xs font-medium text-[#b55cff]">
            <Crown className="h-3 w-3" />
            <span>Tú · Owner</span>
          </div>
        </div>

        {/* Invitation rows */}
        {rows.map((row, idx) => (
          <div key={idx} className="flex gap-2 hover:-translate-y-0.5 transition-transform duration-200">
            <input
              type="email"
              value={row.email}
              onChange={(e) => updateRow(idx, { email: e.target.value })}
              placeholder="teammate@brand.com"
              className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl px-4 py-3 text-sm text-foreground placeholder:text-white/30 transition-all duration-200 hover:border-white/[0.14] focus:border-[#b55cff]/55 focus:outline-none focus:ring-2 focus:ring-[#b55cff]/22 focus:shadow-[0_0_28px_rgba(181,92,255,0.18)]"
            />
            <PremiumSelect
              className="w-32"
              options={INVITABLE_ROLES.map((r) => ({
                key: r.key,
                label: r.label,
                description: r.description,
              }))}
              value={row.role}
              onChange={(v) => updateRow(idx, { role: v as 'ADMIN' | 'MEMBER' })}
              placeholder="Rol"
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 text-white/50 transition hover:bg-white/[0.07] hover:text-white/80"
                title="Quitar"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={addRow}
          className="group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.12] bg-transparent px-4 py-3 text-sm text-white/55 transition-all duration-200 hover:border-[#b55cff]/35 hover:bg-[rgba(181,92,255,0.05)] hover:text-[#e6d2ff]"
        >
          <Plus className="h-4 w-4" />
          Agregar otro compañero
        </button>
      </div>

      {/* Role legend */}
      <div className="adray-laststep-tip mt-6">
        <div className="text-center text-xs uppercase tracking-widest text-white/40">
          Permisos por rol
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          {INVITABLE_ROLES.map((r) => (
            <div key={r.key} className="glass-effect rounded-xl p-3">
              <div className="text-sm font-medium text-foreground">{r.label}</div>
              <div className="text-xs text-white/50">{r.description}</div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/profile')}
          className="rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm text-white/80 transition hover:bg-white/[0.07]"
        >
          ← Atrás
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSkip}
            disabled={sending || updateProfile.isPending}
            className="text-sm text-white/60 transition hover:text-white/80 disabled:opacity-50"
          >
            Saltar por ahora
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || updateProfile.isPending || wsLoading}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#b55cff] to-[#9b7cff] px-6 py-3 text-sm font-semibold text-white shadow-[0_0_22px_rgba(181,92,255,0.34)] transition-all duration-300 hover:shadow-[0_0_36px_rgba(181,92,255,0.52)] hover:-translate-y-0.5',
              (sending || updateProfile.isPending || wsLoading) && 'cursor-not-allowed opacity-50 hover:translate-y-0'
            )}
          >
            {sending ? 'Enviando…' : 'Enviar invitaciones →'}
          </button>
        </div>
      </div>
    </OnboardingLayout>
  );
}
