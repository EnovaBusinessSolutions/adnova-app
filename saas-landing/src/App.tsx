import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Index from "./pages/Index";
import Start from "./pages/Start";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/**
 * ✅ Intercom (Landing - visitante anónimo)
 * - Boot 1 vez
 * - Update en cada cambio de ruta (SPA)
 */
function IntercomLandingBridge() {
  const location = useLocation();

  // Boot 1 vez (anónimo)
  useEffect(() => {
    // @ts-ignore
    if (typeof window !== "undefined" && typeof window.Intercom === "function") {
      // Si por alguna razón Intercom ya estaba "booted", update basta.
      // Pero aquí hacemos boot anónimo seguro.
      // @ts-ignore
      window.Intercom("boot", { app_id: "sqexnuzh" });
    }
    return () => {
      // Limpieza (no suele ejecutarse en SPA, pero es correcto)
      // @ts-ignore
      if (typeof window !== "undefined" && typeof window.Intercom === "function") {
        // @ts-ignore
        window.Intercom("shutdown");
      }
    };
  }, []);

  // Update en navegación SPA
  useEffect(() => {
    // @ts-ignore
    if (typeof window !== "undefined" && typeof window.Intercom === "function") {
      // @ts-ignore
      window.Intercom("update");
    }
  }, [location.pathname]);

  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        {/* ✅ Intercom activo en TODO el landing */}
        <IntercomLandingBridge />

        <Routes>
          <Route path="/" element={<Index />} />

          {/* ✅ Start flow (elige método de inicio) */}
          <Route path="/start" element={<Start />} />

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
