import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingLayout } from '@/layouts/OnboardingLayout';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useUpdateProfile } from '@/hooks/useUpdateProfile';
import { PRIMARY_FOCUS_OPTIONS, type PrimaryFocus } from '@/config/workspaceCatalogs';
import { cn } from '@/lib/utils';

function getInitials(first: string, last: string, email: string): string {
  if (first || last) {
    return `${(first[0] || '').toUpperCase()}${(last[0] || '').toUpperCase()}` || email[0].toUpperCase();
  }
  return (email[0] || '?').toUpperCase();
}

export default function Step2Profile() {
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const updateProfile = useUpdateProfile();

  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [jobTitle, setJobTitle] = useState(user?.jobTitle || '');
  const [primaryFocus, setPrimaryFocus] = useState<PrimaryFocus | ''>(
    (user?.primaryFocus as PrimaryFocus) || ''
  );
  const [error, setError] = useState<string | null>(null);

  const initials = useMemo(
    () => getInitials(firstName, lastName, user?.email || ''),
    [firstName, lastName, user?.email]
  );

  const canSubmit =
    firstName.trim().length >= 1 &&
    firstName.trim().length <= 32 &&
    lastName.trim().length >= 1 &&
    lastName.trim().length <= 32 &&
    primaryFocus !== '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateProfile.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jobTitle: jobTitle.trim(),
        primaryFocus: primaryFocus as PrimaryFocus,
        onboardingStep: 'PROFILE_COMPLETE',
      });
      navigate('/team');
    } catch (err: any) {
      const code = err?.code;
      if (code === 'FIRST_NAME_TOO_LONG' || code === 'LAST_NAME_TOO_LONG') {
        setError('Tu nombre o apellido es demasiado largo (máximo 32 caracteres).');
      } else if (code === 'JOB_TITLE_TOO_LONG') {
        setError('El cargo es muy largo (máximo 64 caracteres).');
      } else {
        setError('No pudimos guardar tu perfil. Intenta de nuevo.');
      }
    }
  }

  return (
    <OnboardingLayout currentStep={2}>
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-[0.22em] text-[#b55cff]">Paso 2 de 3</div>
        <h1 className="gradient-text text-3xl font-semibold leading-tight">Tu perfil</h1>
        <p className="text-sm text-muted-foreground">
          Así te van a reconocer tus compañeros dentro del workspace. Toma como 30 segundos.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        {/* Avatar (solo iniciales por ahora) */}
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-[#b55cff] via-[#9b7cff] to-[#7c6df0] shadow-[0_0_22px_rgba(181,92,255,0.36)] text-xl font-semibold text-white">
            {initials || '?'}
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">Foto de perfil</div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled
                title="Disponible próximamente"
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/30"
              >
                Subir foto
              </button>
              <span className="self-center text-xs text-white/40">
                Por ahora usamos tus iniciales.
              </span>
            </div>
          </div>
        </div>

        {/* First / Last name */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-white/50">Nombre</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={32}
              placeholder="Ej. Victor"
              className="w-full rounded-xl border border-white/[0.08] bg-[rgba(10,10,14,0.6)] px-4 py-3 text-foreground placeholder:text-white/30 focus:border-[#b55cff]/50 focus:outline-none focus:ring-2 focus:ring-[#b55cff]/20 transition"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-white/50">Apellido</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={32}
              placeholder="Ej. Huerta"
              className="w-full rounded-xl border border-white/[0.08] bg-[rgba(10,10,14,0.6)] px-4 py-3 text-foreground placeholder:text-white/30 focus:border-[#b55cff]/50 focus:outline-none focus:ring-2 focus:ring-[#b55cff]/20 transition"
            />
          </div>
        </div>

        {/* Job title */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-widest text-white/50">
            Cargo (opcional)
          </label>
          <input
            type="text"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            maxLength={64}
            placeholder="Ej. Founder, Head of Growth, CMO"
            className="w-full rounded-xl border border-white/[0.08] bg-[rgba(10,10,14,0.6)] px-4 py-3 text-foreground placeholder:text-white/30 focus:border-[#b55cff]/50 focus:outline-none focus:ring-2 focus:ring-[#b55cff]/20 transition"
          />
        </div>

        {/* Primary focus */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-widest text-white/50">
            ¿Cuál describe mejor tu rol?
          </label>
          <select
            value={primaryFocus}
            onChange={(e) => setPrimaryFocus(e.target.value as PrimaryFocus)}
            className="w-full rounded-xl border border-white/[0.08] bg-[rgba(10,10,14,0.6)] px-4 py-3 text-foreground focus:border-[#b55cff]/50 focus:outline-none focus:ring-2 focus:ring-[#b55cff]/20 transition"
          >
            <option value="" disabled>Selecciona una opción…</option>
            {PRIMARY_FOCUS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        <div className="flex justify-between pt-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm text-white/80 transition hover:bg-white/[0.07]"
          >
            ← Atrás
          </button>
          <button
            type="submit"
            disabled={!canSubmit || updateProfile.isPending}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#b55cff] to-[#9b7cff] px-6 py-3 text-sm font-semibold text-white shadow-[0_0_22px_rgba(181,92,255,0.32)] transition hover:shadow-[0_0_32px_rgba(181,92,255,0.5)]',
              (!canSubmit || updateProfile.isPending) && 'cursor-not-allowed opacity-50'
            )}
          >
            {updateProfile.isPending ? 'Guardando…' : 'Continuar →'}
          </button>
        </div>
      </form>
    </OnboardingLayout>
  );
}
