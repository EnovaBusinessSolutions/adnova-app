
import { Link } from "react-router-dom";

export const Footer = () => {
  return (
    <footer className="bg-[#0F0B14] border-t border-[#A259FF]/20 py-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-white">Adray</h3>
            <p className="text-gray-400 text-sm">
              Transformando negocios con inteligencia artificial avanzada.
            </p>
          </div>
          
          {/* Soporte */}
          <div className="space-y-4">
            <h4 className="font-semibold text-[#E7D6FF]">Soporte</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/" className="text-gray-400 hover:text-white transition-colors">Centro de Ayuda</Link></li>
              <li><Link to="/contact" className="text-gray-400 hover:text-white transition-colors">Contacto</Link></li>
            </ul>
          </div>
          
          {/* Empresa */}
          <div className="space-y-4">
            <h4 className="font-semibold text-[#E7D6FF]">Empresa</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Acerca de</a></li>
              <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Privacidad</a></li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-[#A259FF]/20 mt-8 pt-8 text-center">
          <p className="text-gray-400 text-sm">
            © 2026 Adray. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </footer>
  );
};
