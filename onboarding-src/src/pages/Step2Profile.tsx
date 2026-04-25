import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingLayout } from '@/layouts/OnboardingLayout';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useUpdateProfile } from '@/hooks/useUpdateProfile';
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
  const [error, setError] = useState<string | null>(null);

  const initials = useMemo(
    () => getInitials(firstName, lastName, user?.email || ''),
    [firstName, lastName, user?.email]
  );

  const canSubmit =
    firstName.trim().length >= 1 &&
    firstName.trim().length <= 32 &&
    lastName.trim().length >= 1 &&
    lastName.trim().length <= 32;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateProfile.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jobTitle: jobTitle.trim(),
        onboardingStep: 'PROFILE_COMPLETE',
      });
      navigate('/team');
    } catch (err: any) {
      const code = err?.code;
      if (code === 'FIRST_NAME_TOO_LONG' || code === 'LAST_NAME_TOO_LONG') {
        setError('Your first or last name is too long (32 characters max).');
      } else if (code === 'JOB_TITLE_TOO_LONG') {
        setError('Job title is too long (64 characters max).');
      } else {
        setError("We couldn't save your profile. Try again.");
      }
    }
  }

  return (
    <OnboardingLayout currentStep={2}>
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-[0.22em] text-[#b55cff]">Step 2 of 3</div>
        <h1 className="gradient-text text-3xl font-semibold leading-tight">Your profile</h1>
        <p className="text-sm text-muted-foreground">
          This is how your teammates will recognize you inside the workspace. Takes about 30 seconds.
        </p>
      </div>

      {/* Avatar centrado y grande */}
      <div className="flex flex-col items-center gap-3 py-2 mt-6">
        <div
          className={cn(
            "grid h-24 w-24 place-items-center rounded-full text-2xl font-semibold tracking-wide text-white",
            "bg-gradient-to-br from-[#b55cff] via-[#9b7cff] to-[#7c6df0]",
            "shadow-[0_0_36px_rgba(181,92,255,0.42),inset_0_1px_0_rgba(255,255,255,0.18)]",
            "ring-1 ring-white/15"
          )}
        >
          {initials || "?"}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        {/* First / Last name */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-white/50">First name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={32}
              placeholder="e.g. Victor"
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl px-4 py-3 text-foreground placeholder:text-white/30 transition-all duration-200 hover:border-white/[0.14] focus:border-[#b55cff]/55 focus:outline-none focus:ring-2 focus:ring-[#b55cff]/22 focus:shadow-[0_0_28px_rgba(181,92,255,0.18)]"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-white/50">Last name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={32}
              placeholder="e.g. Huerta"
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl px-4 py-3 text-foreground placeholder:text-white/30 transition-all duration-200 hover:border-white/[0.14] focus:border-[#b55cff]/55 focus:outline-none focus:ring-2 focus:ring-[#b55cff]/22 focus:shadow-[0_0_28px_rgba(181,92,255,0.18)]"
            />
          </div>
        </div>

        {/* Job title */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-widest text-white/50">
            Job title (optional)
          </label>
          <input
            type="text"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            maxLength={64}
            placeholder="e.g. Founder, Head of Growth, CMO"
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl px-4 py-3 text-foreground placeholder:text-white/30 transition-all duration-200 hover:border-white/[0.14] focus:border-[#b55cff]/55 focus:outline-none focus:ring-2 focus:ring-[#b55cff]/22 focus:shadow-[0_0_28px_rgba(181,92,255,0.18)]"
          />
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
            ← Back
          </button>
          <button
            type="submit"
            disabled={!canSubmit || updateProfile.isPending}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#b55cff] to-[#9b7cff] px-6 py-3 text-sm font-semibold text-white shadow-[0_0_22px_rgba(181,92,255,0.34)] transition-all duration-300 hover:shadow-[0_0_36px_rgba(181,92,255,0.52)] hover:-translate-y-0.5',
              (!canSubmit || updateProfile.isPending) && 'cursor-not-allowed opacity-50 hover:translate-y-0'
            )}
          >
            {updateProfile.isPending ? 'Saving…' : 'Continue →'}
          </button>
        </div>
      </form>
    </OnboardingLayout>
  );
}
