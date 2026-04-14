// saas-landing/src/lib/intercom.ts
// ✅ Intercom helper (Landing / SPA friendly)
// App ID fijo según tu workspace Intercom.
const APP_ID = "sqexnuzh";

type IntercomFn = (...args: any[]) => void;

function getIntercom(): IntercomFn | null {
  if (typeof window === "undefined") return null;
  // @ts-ignore
  const ic = window.Intercom;
  return typeof ic === "function" ? ic : null;
}

export type IntercomUser = {
  user_id: string;          // requerido para identificar
  email?: string;
  name?: string;
  created_at?: number;      // unix seconds
  user_hash?: string;       // opcional (secure mode)
};

export function intercomAppId() {
  return APP_ID;
}

/**
 * ✅ Boot anónimo (Landing)
 * - Si ya está booted, hacemos update seguro.
 */
export function intercomBootAnonymous(extra?: Record<string, any>) {
  const ic = getIntercom();
  if (!ic) return;

  const settings = {
    app_id: APP_ID,
    ...extra,
  };

  try {
    ic("boot", settings);
  } catch {
    // si ya estaba booted, Intercom puede quejarse; update lo corrige
    try {
      ic("update", settings);
    } catch {
      // noop
    }
  }
}

/**
 * ✅ Boot identificado (para cuando lo usemos en onboarding/dashboard)
 * - Importante: hacemos shutdown primero para limpiar estado anónimo.
 */
export function intercomBootUser(user: IntercomUser, extra?: Record<string, any>) {
  const ic = getIntercom();
  if (!ic) return;

  const settings = {
    app_id: APP_ID,
    ...user,
    ...extra,
  };

  try {
    ic("shutdown");
  } catch {
    // noop
  }

  try {
    ic("boot", settings);
  } catch {
    // si falla por cualquier razón, intentamos update
    try {
      ic("update", settings);
    } catch {
      // noop
    }
  }
}

/**
 * ✅ Update (para SPA: llamar en cambios de ruta)
 */
export function intercomUpdate(extra?: Record<string, any>) {
  const ic = getIntercom();
  if (!ic) return;

  if (extra && Object.keys(extra).length) {
    ic("update", { app_id: APP_ID, ...extra });
  } else {
    ic("update");
  }
}

/**
 * ✅ Shutdown (logout / cambio de contexto)
 */
export function intercomShutdown() {
  const ic = getIntercom();
  if (!ic) return;
  try {
    ic("shutdown");
  } catch {
    // noop
  }
}

/**
 * ✅ Helpers de UI (por si quieres botones)
 */
export function intercomShow() {
  const ic = getIntercom();
  if (!ic) return;
  ic("show");
}

export function intercomHide() {
  const ic = getIntercom();
  if (!ic) return;
  ic("hide");
}

export function intercomShowMessages() {
  const ic = getIntercom();
  if (!ic) return;
  ic("showMessages");
}
