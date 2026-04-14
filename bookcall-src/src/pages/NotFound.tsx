
import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error(
      "Error 404: Usuario intentó acceder a una ruta inexistente:",
      location.pathname
    );
  }, [location.pathname]);

  const handleGoHome = () => {
    navigate("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#5B1899] via-black to-[#0F172A] px-4">
      <div className="text-center bg-black/80 rounded-xl shadow-lg p-8 max-w-md w-full">
        <h1 className="text-6xl font-bold mb-6 text-white">404</h1>
        <p className="text-xl text-white/70 mb-6">¡Página no encontrada!</p>
        <p className="text-white/60 mb-8">
          La página que estás buscando no existe o ha sido movida.
        </p>
        <Button 
          onClick={handleGoHome}
          className="bg-gradient-to-r from-fuchsia-500 to-purple-600 hover:opacity-90"
        >
          Volver al inicio
        </Button>
      </div>
    </div>
  );
}

export default NotFound;
