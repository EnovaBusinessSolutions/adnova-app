// dashboard-src/src/components/DashboardLayout.tsx
import React, { useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import MobileBottomNav from "./MobileBottomNav";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Hook robusto para detectar móvil sin romper SSR/hydration.
 * - Arranca en "false" para no brincar en SSR
 * - Luego calcula en el cliente y escucha cambios
 */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");

    const apply = () => setIsMobile(mql.matches);
    apply();

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);

    // Safari fallback
    if (mql.addEventListener) mql.addEventListener("change", handler);
    else (mql as any).addListener(handler);

    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handler);
      else (mql as any).removeListener(handler);
    };
  }, []);

  return isMobile;
}

const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  const isMobile = useIsMobile();

  // Desktop sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const toggleSidebar = () => setSidebarOpen((v) => !v);

  // Content: en móvil NO hay margen, en desktop sí (solo md+)
  const contentClass = useMemo(() => {
    const base = "flex-1 transition-all duration-300";
    if (isMobile) return `${base} ml-0`;
    return `${base} ${sidebarOpen ? "md:ml-64" : "md:ml-16"} ml-0`;
  }, [isMobile, sidebarOpen]);

  return (
    <div className="min-h-screen bg-[#0B0B0D] flex">
      {/* Desktop: Sidebar normal (NO se renderiza en móvil) */}
      <div className="hidden md:block">
        <Sidebar isOpen={sidebarOpen} onToggle={toggleSidebar} />
      </div>

      {/* Content */}
      <div className={contentClass}>
        {/* En móvil: padding bottom para que la barra inferior no tape contenido */}
        <div className="pb-24 md:pb-0">{children}</div>
      </div>

      {/* Mobile bottom nav (solo móvil, NO afecta desktop) */}
      {isMobile && <MobileBottomNav />}
    </div>
  );
};

export default DashboardLayout;
export { DashboardLayout };
