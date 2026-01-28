import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
    clarity?: (...args: any[]) => void;
  }
}

export function usePixelsPageViews() {
  const location = useLocation();

  // Evita duplicados en DEV con React.StrictMode (en PROD no afecta)
  const lastPathRef = useRef<string>("");

  useEffect(() => {
    const page_path = location.pathname + location.search;

    // Guard anti-duplicado (principalmente útil en dev)
    if (lastPathRef.current === page_path) return;
    lastPathRef.current = page_path;

    const page_location = window.location.href;
    const page_title = document.title;

    // GA4: page_view manual (porque en index.html pusimos send_page_view:false)
    window.gtag?.("event", "page_view", {
      page_path,
      page_location,
      page_title,
    });

    // Meta Pixel: PageView por navegación
    window.fbq?.("track", "PageView");

    // Clarity: set page (útil en SPAs)
    window.clarity?.("set", "page", page_path);
  }, [location.pathname, location.search]);
}
