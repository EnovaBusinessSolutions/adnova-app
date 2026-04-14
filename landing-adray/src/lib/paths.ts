/** Coincide con next.config basePath — úsalo para todo lo que viva en /public */
const BASE = process.env.NEXT_PUBLIC_LANDING_BASE_PATH ?? "";

/**
 * Ruta absoluta a un archivo en `public/` (ej. pub("/images/logo.png") → "/landing/images/logo.png")
 */
export function pub(path: string): string {
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${BASE}${p}`;
}
