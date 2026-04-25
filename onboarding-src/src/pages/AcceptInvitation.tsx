import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { ParticleField } from '@/components/ParticleField';

type AcceptResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success' }
  | { status: 'error'; code: string; message: string; meta?: any };

const ERROR_MESSAGES: Record<string, string> = {
  NEEDS_LOGIN: 'Necesitas iniciar sesión para aceptar la invitación.',
  INVITATION_NOT_FOUND: 'Esta invitación no existe o el link es inválido.',
  INVITATION_EXPIRED: 'Esta invitación ha expirado. Pídele a quien te invitó que la genere de nuevo.',
  INVITATION_REVOKED: 'Esta invitación fue revocada.',
  INVITATION_DECLINED: 'Esta invitación ya fue rechazada antes.',
  INVITATION_ALREADY_ACCEPTED: 'Esta invitación ya fue aceptada antes.',
  EMAIL_MISMATCH: 'Tu email no coincide con el de la invitación. Cierra sesión e inicia con la cuenta correcta.',
  WORKSPACE_NOT_FOUND: 'El workspace al que te invitaron ya no existe.',
  ALREADY_A_MEMBER: 'Ya eres miembro de este workspace.',
};

export default function AcceptInvitation() {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = useState<AcceptResult>({ status: 'idle' });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      setResult({ status: 'loading' });
      try {
        const res = await fetch(`/api/invitations/${token}/accept`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        const json = await res.json().catch(() => ({}));

        if (cancelled) return;

        if (res.ok) {
          setResult({ status: 'success' });
          setTimeout(() => {
            window.location.href = '/dashboard';
          }, 900);
          return;
        }

        const code = json.error || `HTTP_${res.status}`;
        const message = ERROR_MESSAGES[code] || 'No pudimos procesar la invitación. Intenta de nuevo.';
        setResult({ status: 'error', code, message, meta: json });
      } catch (err) {
        if (cancelled) return;
        setResult({
          status: 'error',
          code: 'NETWORK',
          message: 'No pudimos conectar con el servidor. Revisa tu conexión.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="adray-dashboard-shell adray-hero-bg relative min-h-screen overflow-hidden bg-background text-foreground flex items-center justify-center px-6">
      <div className="adray-hero-grid" aria-hidden="true" />
      <div className="adray-hero-beam" aria-hidden="true" />
      <ParticleField variant="multiverse" count={32} />

      <div className="relative z-10 max-w-md w-full text-center space-y-4">
        {result.status === 'loading' && (
          <div className="glass-effect-strong p-6 rounded-2xl space-y-4">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-[#b55cff]" />
            <h1 className="text-xl font-semibold text-foreground">Procesando invitación…</h1>
            <p className="text-sm text-muted-foreground">Esto toma un par de segundos.</p>
          </div>
        )}

        {result.status === 'success' && (
          <div className="glass-effect-strong p-6 rounded-2xl space-y-4">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 shadow-[0_0_24px_rgba(52,211,153,0.32)]">
              <CheckCircle className="h-7 w-7 text-emerald-400" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">¡Bienvenido al workspace!</h1>
            <p className="text-sm text-muted-foreground">Te llevamos al dashboard…</p>
          </div>
        )}

        {result.status === 'error' && (
          <div className="glass-effect-strong p-6 rounded-2xl space-y-4">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-rose-500/30 bg-rose-500/10">
              <AlertCircle className="h-7 w-7 text-rose-400" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">No pudimos aceptar la invitación</h1>
            <p className="text-sm text-muted-foreground">{result.message}</p>

            <div className="pt-2 flex flex-col gap-2">
              {result.code === 'NEEDS_LOGIN' && (
                <a
                  href={`/login?return=${encodeURIComponent(`/onboarding/invitations/${token}`)}`}
                  className="inline-block rounded-xl bg-gradient-to-r from-[#b55cff] to-[#9b7cff] px-6 py-3 text-sm font-semibold text-white shadow-[0_0_22px_rgba(181,92,255,0.32)] transition hover:shadow-[0_0_32px_rgba(181,92,255,0.5)]"
                >
                  Iniciar sesión
                </a>
              )}
              {result.code === 'EMAIL_MISMATCH' && (
                <a
                  href="/logout"
                  className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-6 py-3 text-sm text-white/80 transition hover:bg-white/[0.07]"
                >
                  Cerrar sesión y volver a abrir el link
                </a>
              )}
              {result.code === 'ALREADY_A_MEMBER' && (
                <a
                  href="/dashboard"
                  className="inline-block rounded-xl bg-gradient-to-r from-[#b55cff] to-[#9b7cff] px-6 py-3 text-sm font-semibold text-white shadow-[0_0_22px_rgba(181,92,255,0.32)] transition hover:shadow-[0_0_32px_rgba(181,92,255,0.5)]"
                >
                  Ir al dashboard
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
