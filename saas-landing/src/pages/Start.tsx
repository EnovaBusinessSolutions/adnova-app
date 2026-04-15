// saas-landing/src/pages/Start.tsx
import { useEffect, useMemo, useState } from "react";
import { Mail } from "lucide-react";

type SessionUser = {
  _id?: string;
  email?: string;
  shop?: string;
  onboardingComplete?: boolean;
};

type SessionResponse =
  | { ok: true; authenticated?: boolean; user?: SessionUser; data?: any }
  | { ok?: boolean; authenticated?: boolean; user?: SessionUser; data?: any };

const Start = () => {
  const [checking, setChecking] = useState(true);

  const copy = useMemo(
    () => ({
      badge: "Empieza en menos de 2 minutos",
      titleLine1: "Transforma tu marketing.",
      titleLine2: "Registrate gratis",
      google: "Continue with Google",
      // ✅ En móvil reducimos el label para mantener el mismo alto (40px) sin wrap
      emailDesktop: "Continuar con correo electrónico",
      emailMobile: "Continuar con correo",
      small: "Sin tarjeta • Conexión en minutos • Soporte según plan",
      haveAccount: "¿Ya tienes una cuenta?",
      login: "Inicia sesión aquí",
      termsLead: "Al continuar, aceptas nuestros",
      terms: "Términos",
      privacy: "Política de privacidad",
    }),
    []
  );

  // ✅ Si ya hay sesión, manda directo a onboarding/dashboard
  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      try {
        const res = await fetch("/api/session", { credentials: "include", cache: "no-store" });
        if (!res.ok) return;

        const json: SessionResponse = await res.json();
        const authenticated = Boolean((json as any).authenticated || (json as any).ok);
        if (!authenticated) return;

        const user: SessionUser =
          (json as any).user || (json as any)?.data?.user || (json as any)?.data || null;

        if (!user) return;

        if (user._id) sessionStorage.setItem("userId", user._id);
        if (user.shop) sessionStorage.setItem("shop", user.shop);
        if (user.email) sessionStorage.setItem("email", user.email);

        const redirectUrl = user.onboardingComplete ? "/dashboard" : "/onboarding";
        if (!cancelled) window.location.href = redirectUrl;
      } catch {
        // noop
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // ✅ handlers
  const goGoogle = () => (window.location.href = "/auth/google/login");
  const goEmail = () => (window.location.href = "/register.html");
  const goLogin = () => (window.location.href = "/login");

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background (minimal) */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-background" />
        <div className="absolute -top-44 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-primary/10 blur-[90px] opacity-35" />
        <div className="absolute -bottom-56 right-[-160px] h-[640px] w-[640px] rounded-full bg-secondary/10 blur-[110px] opacity-25" />
      </div>

      {/* Content */}
      <main className="px-4 min-h-screen flex items-start sm:items-center justify-center py-10 sm:py-14 md:py-16">
        <div className="w-full">
          {/* ✅ Más vertical en desktop: menor ancho */}
          <div className="mx-auto w-full max-w-[420px] md:max-w-[440px]">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] shadow-[0_10px_60px_rgba(0,0,0,0.55)] overflow-hidden">
              <div className="px-6 py-9 sm:px-8 sm:py-10 md:px-10 md:py-12">
                {/* Badge */}
                <div className="flex justify-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-foreground/70">
                    <span className="inline-flex h-2 w-2 rounded-full bg-primary/70" />
                    {copy.badge}
                  </div>
                </div>

                {/* Headline */}
                <h1 className="mt-6 text-center leading-[1.02] font-semibold tracking-tight text-foreground">
                  <span className="block text-[34px] sm:text-[38px] md:text-[40px]">
                    {copy.titleLine1}
                  </span>
                  <span className="block text-primary text-[34px] sm:text-[38px] md:text-[40px] mt-2">
                    {copy.titleLine2}
                  </span>
                </h1>

                {/* Actions */}
                <div className="mt-8 space-y-3.5">
                  {/* ✅ Ambos botones comparten el MISMO ancho/alto */}
                  <div className="mx-auto w-full max-w-[400px]">
                    {/* Google */}
                    <button
                      type="button"
                      onClick={goGoogle}
                      className="gsi-material-button w-full"
                      aria-label="Continuar con Google"
                    >
                      <div className="gsi-material-button-state"></div>
                      <div className="gsi-material-button-content-wrapper">
                        <div className="gsi-material-button-icon">
                          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                            <path
                              fill="#EA4335"
                              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                            />
                            <path
                              fill="#4285F4"
                              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                            />
                            <path
                              fill="#34A853"
                              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                            />
                            <path fill="none" d="M0 0h48v48H0z" />
                          </svg>
                        </div>
                        <span className="gsi-material-button-contents">{copy.google}</span>
                        <span style={{ display: "none" }}>{copy.google}</span>
                      </div>
                    </button>

                    {/* Email (MISMAS dimensiones que Google) */}
                    <button
                      type="button"
                      onClick={goEmail}
                      className="email-material-button w-full mt-3"
                      aria-label="Continuar con correo electrónico"
                    >
                      <span className="email-material-button-state" />
                      <span className="email-material-button-content-wrapper">
                        <span className="email-material-button-icon" aria-hidden="true">
                          <Mail className="h-5 w-5" />
                        </span>

                        {/* ✅ Móvil vs Desktop label para evitar wrap */}
                        <span className="email-material-button-contents">
                          <span className="sm:hidden">{copy.emailMobile}</span>
                          <span className="hidden sm:inline">{copy.emailDesktop}</span>
                        </span>
                      </span>
                    </button>
                  </div>
                </div>

                {/* Small hint */}
                <div className="mt-5 text-center text-[11px] text-foreground/45">
                  {copy.small}
                </div>

                {/* Already have account */}
                <div className="mt-7 text-center text-sm text-foreground/70">
                  {copy.haveAccount}{" "}
                  <button
                    type="button"
                    onClick={goLogin}
                    className="text-primary hover:text-primary/90 underline underline-offset-4"
                  >
                    {copy.login}
                  </button>
                </div>

                {/* Checking session */}
                {checking && (
                  <div className="mt-4 text-center text-[11px] text-foreground/45" aria-live="polite">
                    Verificando sesión…
                  </div>
                )}
              </div>

              {/* Terms footer */}
              <div className="border-t border-white/10 px-6 py-4 text-center text-[11px] text-foreground/45">
                {copy.termsLead}{" "}
                <a
                  href="/terms-of-service.html"
                  className="text-foreground/70 hover:text-foreground underline underline-offset-4"
                >
                  {copy.terms}
                </a>{" "}
                y{" "}
                <a
                  href="/politica.html"
                  className="text-foreground/70 hover:text-foreground underline underline-offset-4"
                >
                  {copy.privacy}
                </a>
                .
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Google CSS 1:1 + Email matching dimensions */}
      <style>{`
        /* Google (1:1 de login.html) */
        .gsi-material-button{-moz-user-select:none;-webkit-user-select:none;-ms-user-select:none;-webkit-appearance:none;background-color:#131314;border:1px solid #747775;border-radius:20px;box-sizing:border-box;color:#e3e3e3;cursor:pointer;font-family:'Roboto',arial,sans-serif;font-size:14px;height:40px;letter-spacing:.25px;outline:none;overflow:hidden;padding:0 12px;position:relative;text-align:center;transition:background-color .218s,border-color .218s,box-shadow .218s;vertical-align:middle;white-space:nowrap;max-width:400px;min-width:min-content;border-color:#8e918f}
        .gsi-material-button .gsi-material-button-icon{height:20px;margin-right:12px;min-width:20px;width:20px}
        .gsi-material-button .gsi-material-button-content-wrapper{align-items:center;display:flex;flex-direction:row;flex-wrap:nowrap;height:100%;justify-content:space-between;position:relative;width:100%}
        .gsi-material-button .gsi-material-button-contents{flex-grow:1;font-family:'Roboto',arial,sans-serif;font-weight:500;overflow:hidden;text-overflow:ellipsis;vertical-align:top}
        .gsi-material-button .gsi-material-button-state{transition:opacity .218s;bottom:0;left:0;opacity:0;position:absolute;right:0;top:0}
        .gsi-material-button:disabled{cursor:default;background-color:#13131461;border-color:#8e918f1f}
        .gsi-material-button:disabled .gsi-material-button-state{background-color:#e3e3e31f}
        .gsi-material-button:disabled .gsi-material-button-contents{opacity:38%}
        .gsi-material-button:disabled .gsi-material-button-icon{opacity:38%}
        .gsi-material-button:not(:disabled):active .gsi-material-button-state,.gsi-material-button:not(:disabled):focus .gsi-material-button-state{background-color:white;opacity:12%}
        .gsi-material-button:not(:disabled):hover{box-shadow:0 1px 2px 0 rgba(60,64,67,.30),0 1px 3px 1px rgba(60,64,67,.15)}
        .gsi-material-button:not(:disabled):hover .gsi-material-button-state{background-color:white;opacity:8%}

        /* Email: mismas dimensiones que Google (40px alto, radius 20, padding 0 12) */
        .email-material-button{
          -moz-user-select:none;-webkit-user-select:none;-ms-user-select:none;
          -webkit-appearance:none;
          height:40px;
          border-radius:20px;
          box-sizing:border-box;
          cursor:pointer;
          outline:none;
          overflow:hidden;
          padding:0 12px;
          position:relative;
          text-align:center;
          transition:background-color .218s,border-color .218s,box-shadow .218s,transform .12s ease;
          white-space:nowrap;
          border:1px solid rgba(168,85,247,.35); /* primary-ish */
          background: rgba(168,85,247,.12);
          color:#e9e6f3;
          font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          max-width:400px;
          width:100%;
        }
        .email-material-button:hover{
          background: rgba(168,85,247,.16);
          box-shadow:0 1px 2px 0 rgba(60,64,67,.30),0 1px 3px 1px rgba(60,64,67,.15);
        }
        .email-material-button:active{
          transform: translateY(1px);
        }
        .email-material-button-state{
          transition:opacity .218s;
          bottom:0;left:0;right:0;top:0;
          opacity:0;
          position:absolute;
          background: white;
        }
        .email-material-button:focus .email-material-button-state,
        .email-material-button:active .email-material-button-state{
          opacity: 0.10;
        }
        .email-material-button-content-wrapper{
          align-items:center;
          display:flex;
          flex-direction:row;
          flex-wrap:nowrap;
          height:100%;
          justify-content:space-between;
          position:relative;
          width:100%;
        }
        .email-material-button-icon{
          height:20px;
          margin-right:12px;
          min-width:20px;
          width:20px;
          display:flex;
          align-items:center;
          justify-content:center;
          opacity:.95;
        }
        .email-material-button-contents{
          flex-grow:1;
          font-weight:600;
          font-size:14px;
          overflow:hidden;
          text-overflow:ellipsis;
        }
      `}</style>
    </div>
  );
};

export default Start;
