
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export const ContactForm = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simular envío del formulario
    setTimeout(() => {
      toast({
        title: "Mensaje enviado",
        description: "Hemos recibido tu mensaje. Te responderemos pronto.",
      });
      
      // Limpiar formulario
      setFormData({
        name: "",
        email: "",
        subject: "",
        message: ""
      });
      
      setIsSubmitting(false);
    }, 1000);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-white mb-4">
          Envíanos un Mensaje
        </h2>
        <p className="text-gray-300 text-lg">
          Completa el formulario y nos pondremos en contacto contigo lo antes posible.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-white">
              Nombre completo
            </Label>
            <Input
              id="name"
              name="name"
              type="text"
              value={formData.name}
              onChange={handleChange}
              required
              className="bg-white/10 border-[#A259FF]/30 text-white placeholder:text-gray-400 focus:border-[#A259FF] focus:ring-[#A259FF]"
              placeholder="Tu nombre"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="text-white">
              Correo electrónico
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              required
              className="bg-white/10 border-[#A259FF]/30 text-white placeholder:text-gray-400 focus:border-[#A259FF] focus:ring-[#A259FF]"
              placeholder="tu@email.com"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="subject" className="text-white">
            Asunto
          </Label>
          <Input
            id="subject"
            name="subject"
            type="text"
            value={formData.subject}
            onChange={handleChange}
            required
            className="bg-white/10 border-[#A259FF]/30 text-white placeholder:text-gray-400 focus:border-[#A259FF] focus:ring-[#A259FF]"
            placeholder="¿En qué podemos ayudarte?"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="message" className="text-white">
            Mensaje
          </Label>
          <textarea
            id="message"
            name="message"
            value={formData.message}
            onChange={handleChange}
            required
            rows={6}
            className="w-full px-3 py-2 bg-white/10 border border-[#A259FF]/30 rounded-md text-white placeholder:text-gray-400 focus:border-[#A259FF] focus:ring-1 focus:ring-[#A259FF] focus:outline-none resize-none"
            placeholder="Describe tu consulta en detalle..."
          />
        </div>

        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-gradient-to-r from-[#A259FF] to-[#E7D6FF] hover:from-[#8A4FDB] hover:to-[#D4C5F9] text-white font-semibold py-3 px-6 rounded-lg transition-all duration-300 flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Enviando...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Enviar Mensaje
            </>
          )}
        </Button>
      </form>
    </div>
  );
};
