import { Search, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

export const NavBar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <nav className="fixed top-0 w-full bg-[#100C12]/95 backdrop-blur-sm border-b border-[#A259FF]/20 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center">
            <a href="/" className="text-2xl font-bold text-white hover:text-[#E7D6FF] transition-colors">
              Adray
            </a>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <a
              href="/"
              className="text-white cursor-pointer hover:text-[#E7D6FF] transition-colors"
            >
              Inicio
            </a>
            <Link 
              to="/"  // <-- Cambiado aquí
              className={`transition-colors ${
                location.pathname === '/' 
                  ? 'text-[#A259FF] font-semibold' 
                  : 'text-white hover:text-[#E7D6FF]'
              }`}
            >
              Soporte
            </Link>
            <Link 
              to="/contact"
              className={`transition-colors ${
                location.pathname === '/contact' 
                  ? 'text-[#A259FF] font-semibold' 
                  : 'text-white hover:text-[#E7D6FF]'
              }`}
            >
              Contacto
            </Link>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="text-white hover:text-[#A259FF] transition-colors"
            >
              {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="md:hidden border-t border-[#A259FF]/20 py-4">
            <div className="flex flex-col space-y-4">
              <a
                href="/"
                className="text-white cursor-pointer hover:text-[#E7D6FF] transition-colors"
              >
                Inicio
              </a>
              <Link 
                to="/"  // <-- Cambiado aquí
                className={`transition-colors ${
                  location.pathname === '/' 
                    ? 'text-[#A259FF] font-semibold' 
                    : 'text-white hover:text-[#E7D6FF]'
                }`}
              >
                Soporte
              </Link>
              <Link 
                to="/contact"
                className={`transition-colors ${
                  location.pathname === '/contact' 
                    ? 'text-[#A259FF] font-semibold' 
                    : 'text-white hover:text-[#E7D6FF]'
                }`}
              >
                Contacto
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};
