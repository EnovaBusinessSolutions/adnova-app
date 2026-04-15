
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

export default function Login() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    document.title = "Iniciar Sesión - ADNOVA";
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    // Simular proceso de login
    setTimeout(() => {
      setIsLoading(false);
      toast({
        title: "Éxito",
        description: "Has iniciado sesión correctamente."
      });
      navigate("/onboarding");
    }, 1500);
  };

  const handleOAuthLogin = (provider: string) => {
    setIsLoading(true);
    
    // Simular proceso de login con OAuth
    setTimeout(() => {
      setIsLoading(false);
      toast({
        title: "Éxito",
        description: `Iniciado sesión con ${provider} correctamente.`,
      });
      navigate("/onboarding");
    }, 1500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black px-4">
      <div className="w-full max-w-md bg-black/80 rounded-xl shadow-lg p-8">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-white">
            ADNOVA AI <span className="inline-block ml-1">🤖</span>
          </h1>
          <p className="text-sm text-white/70">
            Optimización de marketing con IA para tu tienda Shopify
          </p>
        </div>

        <h2 className="text-xl font-semibold text-white text-center mb-6">
          Bienvenido de nuevo
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-white mb-1" htmlFor="email">
              Correo electrónico
            </label>
            <input
              type="email"
              id="email"
              required
              placeholder="tu@correo.com"
              className="w-full rounded-md bg-neutral-800 text-white px-4 py-2 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm text-white mb-1" htmlFor="password">
              Contraseña
            </label>
            <input
              type="password"
              id="password"
              required
              className="w-full rounded-md bg-neutral-800 text-white px-4 py-2 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white font-medium py-2 rounded-md hover:opacity-90 transition"
          >
            {isLoading ? "Procesando..." : "Iniciar sesión"}
          </button>
        </form>

        <div className="mt-6 border-t border-neutral-800 pt-4 text-center text-sm text-white/70">
          Continúa con
        </div>

        <div className="mt-4 space-y-3">
          <button 
            onClick={() => handleOAuthLogin("Google")}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 bg-neutral-800 text-white py-2 rounded-md border border-neutral-700 hover:bg-neutral-700 transition"
          >
            <img src="https://img.icons8.com/color/20/google-logo.png" alt="Google" />
            Google
          </button>

          <button 
            onClick={() => handleOAuthLogin("Microsoft")}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 bg-neutral-800 text-white py-2 rounded-md border border-neutral-700 hover:bg-neutral-700 transition"
          >
            <img src="https://img.icons8.com/color/20/windows-10.png" alt="Microsoft" />
            Microsoft
          </button>
        </div>
      </div>
    </div>
  );
}
