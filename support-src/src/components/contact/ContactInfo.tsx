
import { Mail, MapPin, Clock } from "lucide-react";

export const ContactInfo = () => {
  const contactItems = [
    {
      icon: Mail,
      title: "Email",
      description: "Envíanos un correo electrónico",
      value: "Contact@adnova.digital",
      link: "mailto:Contact@adnova.digital"
    },
    {
      icon: MapPin,
      title: "Oficina",
      description: "Visítanos en nuestra oficina",
      value: "Proximamente",
      link: null
    },
    {
      icon: Clock,
      title: "Horario de Atención",
      description: "Estamos disponibles",
      value: "Proximamente",
      link: null
    }
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-white mb-4">
          Información de Contacto
        </h2>
        <p className="text-gray-300 text-lg">
          Conecta con nuestro equipo de soporte especializado. Estamos aquí para 
          resolver todas tus dudas sobre Adray.
        </p>
      </div>

      <div className="space-y-6">
        {contactItems.map((item, index) => (
          <div
            key={index}
            className="flex items-start space-x-4 p-6 rounded-lg bg-white/5 backdrop-blur-sm border border-[#A259FF]/20 hover:border-[#A259FF]/40 transition-colors"
          >
            <div className="flex-shrink-0">
              <div className="w-12 h-12 rounded-lg bg-[#A259FF] flex items-center justify-center">
                <item.icon className="w-6 h-6 text-white" />
              </div>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white mb-1">
                {item.title}
              </h3>
              <p className="text-gray-400 text-sm mb-2">
                {item.description}
              </p>
              {item.link ? (
                <a
                  href={item.link}
                  className="text-[#A259FF] hover:text-[#E7D6FF] transition-colors font-medium"
                >
                  {item.value}
                </a>
              ) : (
                <span className="text-gray-300 font-medium">
                  {item.value}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Additional Info */}
      <div className="mt-8 p-6 rounded-lg bg-gradient-to-r from-[#A259FF]/10 to-[#E7D6FF]/10 border border-[#A259FF]/20">
        <h3 className="text-lg font-semibold text-white mb-2">
          ¿Necesitas ayuda inmediata?
        </h3>
        <p className="text-gray-300 text-sm">
          Visita nuestro centro de ayuda para encontrar respuestas rápidas a las preguntas más frecuentes.
        </p>
      </div>
    </div>
  );
};
