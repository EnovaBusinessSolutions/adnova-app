import { useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const SHOP_KEY = 'adray_analytics_shop';

function readStoredShop(): string {
  try { return localStorage.getItem(SHOP_KEY) ?? ''; } catch { return ''; }
}

function writeStoredShop(shop: string) {
  try {
    if (shop) localStorage.setItem(SHOP_KEY, shop);
    else localStorage.removeItem(SHOP_KEY);
  } catch { /* storage unavailable */ }
}

export function useShopPersistence() {
  const [searchParams, setSearchParams] = useSearchParams();
  const shopFromUrl = searchParams.get('shop') ?? '';

  // On mount: if URL has no shop, try localStorage
  useEffect(() => {
    if (shopFromUrl) {
      writeStoredShop(shopFromUrl);
      return;
    }
    const stored = readStoredShop();
    if (stored) {
      setSearchParams(
        (prev) => { const n = new URLSearchParams(prev); n.set('shop', stored); return n; },
        { replace: true },
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep localStorage in sync when URL shop changes after mount
  useEffect(() => {
    if (shopFromUrl) writeStoredShop(shopFromUrl);
  }, [shopFromUrl]);

  const setShop = useCallback(
    (shop: string) => {
      writeStoredShop(shop);
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (shop) n.set('shop', shop);
          else n.delete('shop');
          return n;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  return { shop: shopFromUrl, setShop };
}
