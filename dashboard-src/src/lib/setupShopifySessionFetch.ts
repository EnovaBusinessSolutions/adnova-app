const API_BYPASS_PATHS = new Set<string>([
  '/api/public-config',
  '/api/register',
  '/api/login',
  '/api/auth/login',
  '/api/forgot-password',
  '/api/auth/verify-email',
  '/api/logout',
]);

let isPatched = false;

function shouldHandle(pathname: string): boolean {
  if (!pathname.startsWith('/api')) return false;
  if (API_BYPASS_PATHS.has(pathname)) return false;
  if (pathname.startsWith('/api/stripe/webhook')) return false;
  if (pathname.startsWith('/api/bookcall')) return false;
  if (pathname.startsWith('/api/cron')) return false;
  return true;
}

async function getShopifySessionToken(): Promise<string> {
  try {
    const shopify = (window as any).shopify;
    if (shopify && typeof shopify.idToken === 'function') {
      const token = await shopify.idToken();
      return typeof token === 'string' ? token : '';
    }
  } catch (_err) {}

  return '';
}

export function setupShopifySessionFetch(): void {
  if (isPatched || typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return;
  }

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url, window.location.origin);

    if (!shouldHandle(url.pathname)) {
      return nativeFetch(request);
    }

    const headers = new Headers(request.headers);
    if (!headers.has('Authorization')) {
      const token = await getShopifySessionToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    const securedRequest = new Request(request, { headers });
    return nativeFetch(securedRequest);
  };

  isPatched = true;
}
