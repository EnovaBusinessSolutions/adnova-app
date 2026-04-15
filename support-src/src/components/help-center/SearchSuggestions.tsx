
import { useState, useEffect } from "react";
import { Search } from "lucide-react";

interface FAQ {
  question: string;
  answer: string;
  categoryTitle: string;
  categoryId: string;
}

interface SearchSuggestionsProps {
  searchQuery: string;
  isVisible: boolean;
  onSuggestionClick: (faq: FAQ) => void;
}

// Todas las preguntas de todos los bloques
const allFAQs: FAQ[] = [
  // Integraciones
  {
    question: "¿Cómo conecto mi tienda Shopify?",
    answer: "Conecta tu tienda para que Adnova AI obtenga productos, ventas y permisos de auditoría.",
    categoryTitle: "Integraciones",
    categoryId: "integrations"
  },
  {
    question: "No se generó el session token dentro de Shopify",
    answer: "El token es necesario para acceder a la API embebida.",
    categoryTitle: "Integraciones",
    categoryId: "integrations"
  },
  {
    question: "¿Cómo vinculo mi cuenta de Google Ads?",
    answer: "Importa campañas y costos para que las auditorías incluyan ROAS y métricas pagas.",
    categoryTitle: "Integraciones",
    categoryId: "integrations"
  },
  {
    question: "¿Cómo agrego Meta Business Manager?",
    answer: "Sincroniza tus cuentas publicitarias de Facebook e Instagram.",
    categoryTitle: "Integraciones",
    categoryId: "integrations"
  },
  
  // Métricas & Reportes
  {
    question: "¿Cómo leo el Informe de Auditoría?",
    answer: "El PDF muestra tu puntaje global y 6 secciones (Velocidad, SEO, Tracking, Ads, UX, Seguridad).",
    categoryTitle: "Métricas & Reportes",
    categoryId: "automation"
  },
  {
    question: "Exportar métricas a Google Sheets",
    answer: "Crea un enlace vivo para tu equipo de datos.",
    categoryTitle: "Métricas & Reportes",
    categoryId: "automation"
  },
  {
    question: "Compartir un reporte con mi cliente",
    answer: "Envía un enlace de solo-lectura sin exponer tu cuenta.",
    categoryTitle: "Métricas & Reportes",
    categoryId: "automation"
  },
  {
    question: "Personalizar el rango de fechas del dashboard",
    answer: "Compara períodos y detecta tendencias.",
    categoryTitle: "Métricas & Reportes",
    categoryId: "automation"
  },
  
  // Facturación
  {
    question: "¿Cómo cambio de plan?",
    answer: "Sube o baja tu suscripción en cualquier momento, sin perder datos.",
    categoryTitle: "Facturación",
    categoryId: "billing"
  },
  {
    question: "¿Dónde descargo mis facturas?",
    answer: "Disponibles en PDF para contabilidad.",
    categoryTitle: "Facturación",
    categoryId: "billing"
  },
  {
    question: "¿Se puede pausar la suscripción?",
    answer: "Sí, hasta 60 días sin perder datos.",
    categoryTitle: "Facturación",
    categoryId: "billing"
  },
  
  // Seguridad
  {
    question: "¿Dónde se almacenan mis datos?",
    answer: "En AWS eu-central-1, cifrado AES-256 en reposo y TLS 1.3 en tránsito.",
    categoryTitle: "Seguridad",
    categoryId: "security"
  },
  {
    question: "¿Cómo revoco el token de Shopify?",
    answer: "Útil si cambias credenciales o tienes sospecha de acceso indebido.",
    categoryTitle: "Seguridad",
    categoryId: "security"
  },
  {
    question: "¿Cómo cambiar mi contraseña?",
    answer: "Mantén tu contraseña segura actualizándola regularmente.",
    categoryTitle: "Seguridad",
    categoryId: "security"
  },
  {
    question: "¿Qué hacer si sospecho que mi cuenta fue comprometida?",
    answer: "Actúa rápidamente para proteger tu cuenta si detectas actividad sospechosa.",
    categoryTitle: "Seguridad",
    categoryId: "security"
  },
  {
    question: "Roles y permisos en Adnova AI",
    answer: "Tres niveles: Owner, Editor, Viewer.",
    categoryTitle: "Seguridad",
    categoryId: "security"
  },
  
  // Solución de Problemas
  {
    question: "'Token de sesión inválido' al abrir la app",
    answer: "El iframe embebido no pudo validar el JWT.",
    categoryTitle: "Solución de Problemas",
    categoryId: "troubleshooting"
  },
  {
    question: "El score de auditoría se queda en 0%",
    answer: "Normalmente falta permiso de lectura de productos o pedidos.",
    categoryTitle: "Solución de Problemas",
    categoryId: "troubleshooting"
  },
  {
    question: "Métricas no actualizan desde hace 24 h",
    answer: "Puede ser un límite de API o fallo de cron.",
    categoryTitle: "Solución de Problemas",
    categoryId: "troubleshooting"
  },
  {
    question: "Error 403 en la API externa",
    answer: "Autenticación fallida en tu integración con Adnova API.",
    categoryTitle: "Solución de Problemas",
    categoryId: "troubleshooting"
  },
  
  // Dashboard & Funciones Claves
  {
    question: "Personalizar widgets del dashboard",
    answer: "Muestra solo los KPI que te interesan.",
    categoryTitle: "Dashboard & Funciones Claves",
    categoryId: "community"
  },
  {
    question: "¿Qué es el Verificador de Pixel?",
    answer: "Comprueba que tu pixel de Meta/Google esté disparando eventos correctos.",
    categoryTitle: "Dashboard & Funciones Claves",
    categoryId: "community"
  },
  {
    question: "Configurar metas de negocio",
    answer: "Establece objetivos y recibe alertas cuando te alejes del target.",
    categoryTitle: "Dashboard & Funciones Claves",
    categoryId: "community"
  },
  {
    question: "Modo Agencia (multi-tienda)",
    answer: "Gestiona varias tiendas en una sola vista.",
    categoryTitle: "Dashboard & Funciones Claves",
    categoryId: "community"
  }
];

export const SearchSuggestions = ({ searchQuery, isVisible, onSuggestionClick }: SearchSuggestionsProps) => {
  const [filteredSuggestions, setFilteredSuggestions] = useState<FAQ[]>([]);

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setFilteredSuggestions([]);
      return;
    }

    const filtered = allFAQs.filter(faq => 
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.categoryTitle.toLowerCase().includes(searchQuery.toLowerCase())
    ).slice(0, 8); // Limitar a 8 resultados

    setFilteredSuggestions(filtered);
  }, [searchQuery]);

  if (!isVisible || filteredSuggestions.length === 0) {
    return null;
  }

  return (
    <div className="absolute top-full left-0 right-0 mt-2 bg-[#1A1625] border border-[#A259FF]/30 rounded-xl shadow-lg z-50 max-h-96 overflow-y-auto">
      <div className="p-3">
        <div className="flex items-center space-x-2 mb-3 text-sm text-gray-400">
          <Search size={16} />
          <span>Resultados para "{searchQuery}"</span>
        </div>
        
        <div className="space-y-2">
          {filteredSuggestions.map((faq, index) => (
            <button
              key={index}
              onClick={() => onSuggestionClick(faq)}
              className="w-full text-left p-3 hover:bg-[#A259FF]/10 rounded-lg transition-colors group"
            >
              <div className="flex flex-col space-y-1">
                <div className="text-white font-medium group-hover:text-[#E7D6FF]">
                  {faq.question}
                </div>
                <div className="text-xs text-[#A259FF] font-medium">
                  {faq.categoryTitle}
                </div>
                <div className="text-sm text-gray-400 line-clamp-2">
                  {faq.answer}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
