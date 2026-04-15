import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";

/* Páginas */
import Index from "./pages/Index";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Audit from "./pages/Audit";
import PixelVerifier from "./pages/PixelVerifier";
import ComingSoon from "./pages/ComingSoon";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import Confirmation from "./pages/Confirmation";

/* Layout */
import { default as DashboardLayout } from "./components/layout/DashboardLayout";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />

      {/* Importante: basename para que el SPA viva bajo /bookcall */}
      <BrowserRouter basename="/bookcall">
        <Routes>
          {/* Página inicial */}
          <Route index element={<Index />} />
          <Route path="/" element={<Index />} />

          {/* Público */}
          <Route path="/login" element={<Login />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/confirmation" element={<Confirmation />} />

          {/* Área con layout (rutas “internas”) */}
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/pixel-verifier" element={<PixelVerifier />} />
            <Route path="/coming-soon" element={<ComingSoon />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
