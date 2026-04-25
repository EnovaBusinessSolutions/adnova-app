import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react';

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
    <div className="min-h-screen bg-bg text-white flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-4">
        {result.status === 'loading' && (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-accent" />
            <h1 className="text-xl font-semibold">Procesando invitación…</h1>
            <p className="text-sm text-white/60">Esto toma un par de segundos.</p>
          </>
        )}

        {result.status === 'success' && (
          <>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
              <CheckCircle className="h-7 w-7 text-emerald-400" />
            </div>
            <h1 className="text-xl font-semibold">¡Bienvenido al workspace!</h1>
            <p className="text-sm text-white/60">Te llevamos al dashboard…</p>
          </>
        )}

        {result.status === 'error' && (
          <>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-rose-500/30 bg-rose-500/10">
              <AlertCircle className="h-7 w-7 text-rose-400" />
            </div>
            <h1 className="text-xl font-semibold">No pudimos aceptar la invitación</h1>
            <p className="text-sm text-white/60">{result.message}</p>

            <div className="pt-4 flex flex-col gap-2">
              {result.code === 'NEEDS_LOGIN' && (
                <a
                  href={`/login?return=${encodeURIComponent(`/onboarding/invitations/${token}`)}`}
                  className="inline-block rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white hover:bg-accent-hover"
                >
                  Iniciar sesión
                </a>
              )}
              {result.code === 'EMAIL_MISMATCH' && (
                <a
                  href="/logout"
                  className="inline-block rounded-xl border border-white/10 bg-white/[0.04] px-6 py-3 text-sm text-white/80 hover:bg-white/[0.07]"
                >
                  Cerrar sesión y volver a abrir el link
                </a>
              )}
              {result.code === 'ALREADY_A_MEMBER' && (
                <a
                  href="/dashboard"
                  className="inline-block rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white hover:bg-accent-hover"
                >
                  Ir al dashboard
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
