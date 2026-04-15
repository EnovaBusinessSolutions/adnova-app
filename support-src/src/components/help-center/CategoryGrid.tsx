import { useState, useEffect } from "react";
import { 
  Settings, 
  BarChart3, 
  CreditCard, 
  Shield, 
  AlertTriangle, 
  TrendingUp, 
  ChevronDown,
  ChevronUp,
  ThumbsUp,
  ThumbsDown
} from "lucide-react";

interface FAQ {
  question: string;
  answer: string;
  steps?: string[];
  hasMedia?: boolean;
}

interface SelectedFAQ {
  question: string;
  answer: string;
  categoryTitle: string;
  categoryId: string;
}

interface Category {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  faqs: FAQ[];
}

interface CategoryGridProps {
  selectedFAQ?: SelectedFAQ | null;
  onFAQProcessed?: () => void;
}

const categories: Category[] = [
  {
    id: "integrations",
    title: "Integraciones",
    description: "Conecta Adnova AI con tus herramientas favoritas",
    icon: Settings,
    faqs: [
      {
        question: "¿Cómo conecto mi tienda Shopify?",
        answer: "Conecta tu tienda para que Adnova AI obtenga productos, ventas y permisos de auditoría.",
        steps: [
          "Haz clic en Conectar Shopify en el onboarding o ve a Ajustes → Integraciones",
          "Ingresa la URL de tu tienda (formato midominio.myshopify.com)",
          "Acepta los permisos en la ventana de Shopify",
          "Al volver al dashboard verás 'Shopify conectado' y la última sincronización"
        ],
        hasMedia: true
      },
      {
        question: "No se generó el session token dentro de Shopify",
        answer: "El token es necesario para acceder a la API embebida.",
        steps: [
          "Verifica que la app se abra dentro del Admin de Shopify (no en ventana externa)",
          "Borra cookies del dominio admin.shopify.com y vuelve a abrir la app",
          "Si usas Brave/Edge, desactiva el 'Bloqueo de 3rd-party cookies' temporalmente",
          "Comprueba que la variable SHOPIFY_API_KEY en tu interface.html sea correcta",
          "Si el error persiste, envía el log de consola a soporte"
        ]
      },
      {
        question: "¿Cómo vinculo mi cuenta de Google Ads?",
        answer: "Importa campañas y costos para que las auditorías incluyan ROAS y métricas pagas.",
        steps: [
          "En el paso Conectar cuentas del onboarding pulsa Google Ads",
          "Selecciona el perfil de Google con acceso a tu MCC",
          "Concede los permisos solicitados y regresa a Adnova"
        ],
        hasMedia: true
      },
      {
        question: "¿Cómo agrego Meta Business Manager?",
        answer: "Sincroniza tus cuentas publicitarias de Facebook e Instagram.",
        steps: [
          "Ve a Ajustes → Integraciones → Meta",
          "Pulsa Conectar y elige tu Business Manager",
          "Activa los ad accounts y pixeles que quieras usar",
          "Guarda y espera la confirmación 'Meta conectado'"
        ]
      }
    ]
  },
  {
    id: "automation",
    title: "Métricas & Reportes",
    description: "Analiza el rendimiento de tu negocio con informes detallados",
    icon: TrendingUp,
    faqs: [
      {
        question: "¿Cómo leo el Informe de Auditoría?",
        answer: "El PDF muestra tu puntaje global y 6 secciones (Velocidad, SEO, Tracking, Ads, UX, Seguridad).",
        steps: [
          "Abre el PDF o la vista web",
          "Fíjate en el score global (círculo arriba)",
          "Desplázate para ver cada sección con su semáforo (verde, amarillo, rojo)",
          "Haz clic en 'Acciones sugeridas' para ver tareas concretas"
        ],
        hasMedia: true
      },
      {
        question: "Exportar métricas a Google Sheets",
        answer: "Crea un enlace vivo para tu equipo de datos.",
        steps: [
          "Dashboard → Reportes",
          "Pulsa Exportar → Google Sheets",
          "Elige tu cuenta de Google y la hoja destino",
          "Verás un nuevo tab con los KPI y actualización cada 24 h"
        ]
      },
      {
        question: "Compartir un reporte con mi cliente",
        answer: "Envía un enlace de solo-lectura sin exponer tu cuenta.",
        steps: [
          "Reportes → selecciona el informe",
          "Clic en Compartir → Crear enlace público",
          "Elige expiración (7 días, 30 días, sin límite)",
          "Copia el link y envíalo"
        ]
      },
      {
        question: "Personalizar el rango de fechas del dashboard",
        answer: "Compara períodos y detecta tendencias.",
        steps: [
          "Arriba a la derecha: selecciona el picker de fechas",
          "Elige Últimos 7 días, Mes actual o Personalizado",
          "El dashboard y los widgets se recalculan automáticamente. {{GIF: cambiar-fechas}}"
        ]
      }
    ]
  },
  {
    id: "billing",
    title: "Facturación",
    description: "Gestiona tu suscripción y pagos",
    icon: CreditCard,
    faqs: [
      {
        question: "¿Cómo cambio de plan?",
        answer: "Sube o baja tu suscripción en cualquier momento, sin perder datos.",
        steps: [
          "Perfil → Facturación",
          "Haz clic en Cambiar plan",
          "Selecciona el nuevo plan y confirma",
          "El cambio se refleja al instante y se prorratea en tu próxima factura"
        ]
      },
      {
        question: "¿Dónde descargo mis facturas?",
        answer: "Disponibles en PDF para contabilidad.",
        steps: [
          "Perfil → Facturación → Historial",
          "Haz clic en el icono Descargar PDF junto a cada mes"
        ]
      },
      {
        question: "¿Se puede pausar la suscripción?",
        answer: "Sí, hasta 60 días sin perder datos.",
        steps: [
          "En Facturación selecciona Pausar",
          "Confirma la fecha de reactivación",
          "Durante la pausa el acceso será de solo-lectura"
        ]
      }
    ]
  },
  {
    id: "security",
    title: "Seguridad",
    description: "Protege tu cuenta y datos",
    icon: Shield,
    faqs: [
      {
        question: "¿Dónde se almacenan mis datos?",
        answer: "En AWS eu-central-1, cifrado AES-256 en reposo y TLS 1.3 en tránsito.",
        steps: [
          "Cumplimos GDPR/CCPA",
          "Copias de seguridad diarias, retención 30 días"
        ]
      },
      {
        question: "¿Cómo revoco el token de Shopify?",
        answer: "Útil si cambias credenciales o tienes sospecha de acceso indebido.",
        steps: [
          "Shopify Admin → Apps → Adnova Connector",
          "Haz clic en Eliminar acceso",
          "Vuelve a Adnova AI y pulsa Conectar Shopify para regenerar permisos"
        ]
      },
      {
        question: "¿Cómo cambiar mi contraseña?",
        answer: "Mantén tu contraseña segura actualizándola regularmente.",
        steps: [
          "Accede a Configuración > Seguridad",
          "Selecciona 'Cambiar Contraseña'",
          "Ingresa tu contraseña actual",
          "Crea una nueva contraseña segura y confírmala"
        ]
      },
      {
        question: "¿Qué hacer si sospecho que mi cuenta fue comprometida?",
        answer: "Actúa rápidamente para proteger tu cuenta si detectas actividad sospechosa.",
        steps: [
          "Cambia tu contraseña inmediatamente",
          "Revisa el registro de actividad en tu cuenta",
          "Cierra todas las sesiones activas",
          "Contacta a nuestro equipo de soporte si es necesario"
        ]
      },
      {
        question: "Roles y permisos en Adnova AI",
        answer: "Tres niveles: Owner, Editor, Viewer.",
        steps: [
          "Owner: todo, incluida facturación",
          "Editor: crear auditorías, ver métricas",
          "Viewer: solo lectura",
          "Asignas roles en Configuración → Usuarios"
        ]
      }
    ]
  },
  {
    id: "troubleshooting",
    title: "Solución de Problemas",
    description: "Resuelve errores comunes y problemas técnicos",
    icon: AlertTriangle,
    faqs: [
      {
        question: "'Token de sesión inválido' al abrir la app",
        answer: "El iframe embebido no pudo validar el JWT.",
        steps: [
          "Asegúrate de abrir Adnova dentro de Shopify Admin",
          "Borra cookies de admin.shopify.com",
          "Comprueba que tu reloj del sistema esté en hora; un desfase > 5 min invalida el token",
          "Reinstala la app si el problema persiste"
        ]
      },
      {
        question: "El score de auditoría se queda en 0%",
        answer: "Normalmente falta permiso de lectura de productos o pedidos.",
        steps: [
          "Shopify Admin → Apps → Adnova Connector → Editar permisos",
          "Activa read_products y read_orders",
          "Vuelve a ejecutar la auditoría"
        ]
      },
      {
        question: "Métricas no actualizan desde hace 24 h",
        answer: "Puede ser un límite de API o fallo de cron.",
        steps: [
          "Dashboard → Estado: revisa si Shopify/Google aparecen 'Online'",
          "Verifica que tu plan no haya alcanzado el límite mensual de solicitudes",
          "Pulsa Sincronizar ahora (botón bajo el contador)",
          "Si sigue igual, contacta soporte con tu shop_id"
        ]
      },
      {
        question: "Error 403 en la API externa",
        answer: "Autenticación fallida en tu integración con Adnova API.",
        steps: [
          "Chequea que uses el header Authorization: Bearer <API_KEY>",
          "Revisa que la key no esté revocada (Perfil → Tokens API)",
          "Asegura que llamas al endpoint correcto (/v1/...)",
          "Intenta regenerar la clave y probar de nuevo"
        ]
      }
    ]
  },
  {
    id: "community",
    title: "Dashboard & Funciones Claves",
    description: "Personaliza y optimiza tu panel de control",
    icon: BarChart3,
    faqs: [
      {
        question: "Personalizar widgets del dashboard",
        answer: "Muestra solo los KPI que te interesan.",
        steps: [
          "Pulsa Editar panel (icono lápiz)",
          "Activa/Desactiva widgets: Conversion Rate, ROAS, AOV, Uptime",
          "Arrastra para reordenar",
          "Clic Guardar"
        ]
      },
      {
        question: "¿Qué es el Verificador de Pixel?",
        answer: "Comprueba que tu pixel de Meta/Google esté disparando eventos correctos.",
        steps: [
          "Dashboard → Pixel Checker",
          "Ingresa la URL de la página de producto",
          "Haz clic en Comprobar",
          "Verás eventos capturados en vivo: AddToCart, Purchase...",
          "Los errores aparecen en rojo con sugerencia. {{IMG: pixel-check}}"
        ]
      },
      {
        question: "Configurar metas de negocio",
        answer: "Establece objetivos y recibe alertas cuando te alejes del target.",
        steps: [
          "Dashboard → Goals",
          "Elige métrica (p.ej. ROAS mínimo 5 ×)",
          "Define período de evaluación (semanal/mensual)",
          "Habilita alertas por Slack o email"
        ]
      },
      {
        question: "Modo Agencia (multi-tienda)",
        answer: "Gestiona varias tiendas en una sola vista.",
        steps: [
          "Perfil → Cambiar a Agencia",
          "Añade tus tiendas con la misma API Key",
          "Usa el selector All Stores / Store X en la cabecera",
          "Los reportes y métricas se agregan automáticamente"
        ]
      }
    ]
  }
];

export const CategoryGrid = ({ selectedFAQ, onFAQProcessed }: CategoryGridProps) => {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedFAQ, setExpandedFAQ] = useState<string | null>(null);
  const [clickedThumbs, setClickedThumbs] = useState<Record<string, 'up' | 'down' | null>>({});

  // Efecto para manejar la selección de FAQ desde búsqueda
  useEffect(() => {
    if (selectedFAQ) {
      // Expandir la categoría correspondiente
      setExpandedCategory(selectedFAQ.categoryId);
      
      // Buscar el índice del FAQ dentro de la categoría
      const category = categories.find(cat => cat.id === selectedFAQ.categoryId);
      if (category) {
        const faqIndex = category.faqs.findIndex(faq => faq.question === selectedFAQ.question);
        if (faqIndex !== -1) {
          const faqId = `${selectedFAQ.categoryId}-${faqIndex}`;
          setExpandedFAQ(faqId);
          
          // Scroll hacia el FAQ específico después de un pequeño delay
          setTimeout(() => {
            const faqElement = document.getElementById(faqId);
            if (faqElement) {
              faqElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 300);
        }
      }
      
      // Notificar que se procesó la selección
      if (onFAQProcessed) {
        onFAQProcessed();
      }
    }
  }, [selectedFAQ, onFAQProcessed]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategory(expandedCategory === categoryId ? null : categoryId);
    setExpandedFAQ(null);
  };

  const toggleFAQ = (faqId: string) => {
    setExpandedFAQ(expandedFAQ === faqId ? null : faqId);
    // Clear thumb state when switching FAQs
    if (expandedFAQ !== faqId) {
      setClickedThumbs(prev => ({
        ...prev,
        [faqId]: null
      }));
    }
  };

  const handleThumbClick = (faqId: string, thumbType: 'up' | 'down') => {
    setClickedThumbs(prev => ({
      ...prev,
      [faqId]: prev[faqId] === thumbType ? null : thumbType
    }));
  };

  return (
    <section className="py-16 bg-[#100C12]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold text-center text-white mb-12">
          Categorías de Ayuda
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map((category) => {
            const Icon = category.icon;
            const isExpanded = expandedCategory === category.id;
            
            return (
              <div key={category.id} className="space-y-4 flex flex-col">
                <div
                  onClick={() => toggleCategory(category.id)}
                  className="bg-[#1A1625] border border-[#A259FF]/20 rounded-xl p-6 cursor-pointer transition-all duration-300 hover:border-[#A259FF]/40 hover:shadow-[0_0_24px_#A259FF33] group flex-1 flex flex-col"
                >
                  <div className="flex items-start justify-between h-full">
                    <div className="flex items-start space-x-4 flex-1">
                      <Icon className="text-[#A259FF] group-hover:text-[#A64BFF] mt-1 flex-shrink-0" size={24} />
                      <div className="flex-1 min-h-0">
                        <h3 className="text-lg font-semibold text-white group-hover:text-[#E7D6FF] mb-2">
                          {category.title}
                        </h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                          {category.description}
                        </p>
                      </div>
                    </div>
                    {category.faqs.length > 0 && (
                      <div className="ml-4 flex-shrink-0">
                        {isExpanded ? (
                          <ChevronUp className="text-[#A259FF]" size={20} />
                        ) : (
                          <ChevronDown className="text-[#A259FF]" size={20} />
                        )}
                      </div>
                    )}
                  </div>
                  
                  {category.faqs.length === 0 && (
                    <div className="mt-4 text-sm text-gray-500">
                      Próximamente disponible
                    </div>
                  )}
                </div>

                {/* FAQ Accordion */}
                {isExpanded && category.faqs.length > 0 && (
                  <div className="space-y-3 animate-fade-in">
                    {category.faqs.map((faq, index) => {
                      const faqId = `${category.id}-${index}`;
                      const isFAQExpanded = expandedFAQ === faqId;
                      const currentThumb = clickedThumbs[faqId];
                      
                      return (
                        <div
                          key={faqId}
                          id={faqId}
                          className="bg-[#0F0B14] border border-[#A259FF]/10 rounded-lg overflow-hidden"
                        >
                          <button
                            onClick={() => toggleFAQ(faqId)}
                            className="w-full px-4 py-3 text-left hover:bg-[#1A1625] transition-colors flex items-center justify-between"
                          >
                            <span className="text-white font-medium">
                              {faq.question}
                            </span>
                            {isFAQExpanded ? (
                              <ChevronUp className="text-[#A259FF]" size={16} />
                            ) : (
                              <ChevronDown className="text-[#A259FF]" size={16} />
                            )}
                          </button>
                          
                          {isFAQExpanded && (
                            <div className="px-4 pb-4 animate-fade-in">
                              <p className="text-gray-300 mb-4">{faq.answer}</p>
                              
                              {faq.steps && (
                                <div className="mb-4">
                                  <h5 className="text-[#E7D6FF] font-medium mb-2">Pasos a seguir:</h5>
                                  <ol className="space-y-2">
                                    {faq.steps.map((step, stepIndex) => (
                                      <li key={stepIndex} className="flex items-start space-x-3">
                                        <span className="bg-[#A259FF] text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                                          {stepIndex + 1}
                                        </span>
                                        <span className="text-gray-300 text-sm">{step}</span>
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              )}
                              
                              <div className="flex items-center justify-between pt-3 border-t border-[#A259FF]/10">
                                <span className="text-sm text-gray-400">¿Te ayudó esto?</span>
                                <div className="flex space-x-2">
                                  <button 
                                    onClick={() => handleThumbClick(faqId, 'up')}
                                    className="p-2 hover:bg-[#1A1625] rounded-lg transition-all duration-200 group relative overflow-hidden"
                                  >
                                    <ThumbsUp 
                                      className={`transition-all duration-200 group-hover:scale-110 ${
                                        currentThumb === 'up' 
                                          ? 'text-green-400 scale-125' 
                                          : 'text-gray-400 group-hover:text-[#A259FF]'
                                      }`} 
                                      size={16} 
                                    />
                                    <div className="absolute inset-0 bg-[#A259FF]/20 rounded-lg scale-0 group-hover:scale-100 transition-transform duration-300 ease-out -z-10" />
                                  </button>
                                  <button 
                                    onClick={() => handleThumbClick(faqId, 'down')}
                                    className="p-2 hover:bg-[#1A1625] rounded-lg transition-all duration-200 group relative overflow-hidden"
                                  >
                                    <ThumbsDown 
                                      className={`transition-all duration-200 group-hover:scale-110 ${
                                        currentThumb === 'down' 
                                          ? 'text-red-400 scale-125' 
                                          : 'text-gray-400 group-hover:text-[#A259FF]'
                                      }`} 
                                      size={16} 
                                    />
                                    <div className="absolute inset-0 bg-[#A259FF]/20 rounded-lg scale-0 group-hover:scale-100 transition-transform duration-300 ease-out -z-10" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
