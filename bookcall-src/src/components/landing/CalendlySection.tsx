import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, Phone, Mail, Globe, Sparkles } from "lucide-react";

const countryCodes = [
  { code: "+52", country: "MX", flag: "🇲🇽" },
  { code: "+1", country: "US/CA", flag: "🇺🇸" },
  { code: "+54", country: "AR", flag: "🇦🇷" },
  { code: "+57", country: "CO", flag: "🇨🇴" },
  { code: "+56", country: "CL", flag: "🇨🇱" },
  { code: "+51", country: "PE", flag: "🇵🇪" },
  { code: "+58", country: "VE", flag: "🇻🇪" },
  { code: "+593", country: "EC", flag: "🇪🇨" },
  { code: "+55", country: "BR", flag: "🇧🇷" },
];

const step1Schema = z.object({
  fullName: z.string().trim().min(2, { message: "El nombre debe tener al menos 2 caracteres" }).max(100, { message: "El nombre es demasiado largo" }),
  phone: z.string().trim().min(8, { message: "El celular debe tener al menos 8 dígitos" }).max(20, { message: "El celular es inválido" }),
  email: z.string().trim().email({ message: "Email inválido" }).max(255, { message: "El email es demasiado largo" }),
});

const step2Schema = z.object({
  website: z.string()
    .trim()
    .min(3, { message: "Por favor ingresa una URL" })
    .max(500, { message: "La URL es demasiado larga" })
    .refine(
      (val) => {
        // Acepta URLs con o sin protocolo
        const urlPattern = /^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)$/;
        return urlPattern.test(val);
      },
      { message: "Por favor ingresa una URL válida (ej: www.ejemplo.com)" }
    ),
});

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;

export function CalendlySection() {
  const [step, setStep] = useState(1);
  const [step1Data, setStep1Data] = useState<Step1Data | null>(null);
  const [countryCode, setCountryCode] = useState("+52");

  const form1 = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      fullName: "",
      phone: "",
      email: "",
    },
  });

  const form2 = useForm<Step2Data>({
    resolver: zodResolver(step2Schema),
    defaultValues: {
      website: "",
    },
  });

  const onStep1Submit = (data: Step1Data) => {
    const dataWithCountryCode = {
      ...data,
      phone: `${countryCode} ${data.phone}`
    };
    setStep1Data(dataWithCountryCode);
    setStep(2);
  };

 const onStep2Submit = async (data: Step2Data) => {
  const payload = { ...(step1Data || {}), ...data };

  try {
    await fetch('/api/bookcall/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (_) {
    // No bloquees la agenda si falla el append a Sheets
  }

  // Abrir flujo de agenda
  window.location.assign('/agendar?go=1');
};


  // Resetear form2 cuando se muestra el paso 2
  useEffect(() => {
    if (step === 2) {
      form2.reset({ website: "" });
    }
  }, [step, form2]);

  return (
    <section id="agendar" className="py-20 bg-background">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="text-center mb-12 animate-fade-in">
          <div className="inline-flex items-center gap-2 mb-4 px-4 py-2 bg-primary/10 rounded-full">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium text-primary">Paso {step} de 2</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4 px-4">
            Agenda tu Auditoría Gratuita
          </h2>
          <p className="text-base md:text-lg lg:text-xl text-muted-foreground px-4">
            {step === 1 ? "Cuéntanos sobre ti y tu empresa" : "Para que nuestra IA haga un análisis previo a la reunión necesitamos el sitio"}
          </p>
        </div>

        <div className="bg-card rounded-2xl shadow-elevated p-6 md:p-8 border border-border backdrop-blur-sm animate-scale-in">
          {step === 1 ? (
            <Form {...form1} key="form-step-1">
              <form onSubmit={form1.handleSubmit(onStep1Submit)} className="space-y-6">
                <div className="animate-fade-in" style={{ animationDelay: "0.1s", animationFillMode: "both" }}>
                  <FormField
                    control={form1.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <User className="w-4 h-4 text-primary" />
                          Nombre y Apellido
                        </FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Escribe tu nombre completo" 
                            className="transition-all duration-300 focus:scale-[1.02]"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="animate-fade-in" style={{ animationDelay: "0.2s", animationFillMode: "both" }}>
                  <FormField
                    control={form1.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Phone className="w-4 h-4 text-primary" />
                          Celular
                        </FormLabel>
                        <div className="flex gap-2">
                          <Select value={countryCode} onValueChange={setCountryCode}>
                            <SelectTrigger className="w-[130px] transition-all duration-300 focus:scale-[1.02] bg-background">
                              <SelectValue>
                                <span className="flex items-center gap-2">
                                  <span className="text-lg">{countryCodes.find(c => c.code === countryCode)?.flag}</span>
                                  <span>{countryCode}</span>
                                </span>
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="bg-background border border-border z-50">
                              {countryCodes.map((country) => (
                                <SelectItem 
                                  key={country.code} 
                                  value={country.code}
                                  className="cursor-pointer hover:bg-accent"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-lg">{country.flag}</span>
                                    <span>{country.code}</span>
                                    <span className="text-muted-foreground text-xs">{country.country}</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormControl>
                            <Input 
                              placeholder="Número de contacto" 
                              type="tel"
                              className="flex-1 transition-all duration-300 focus:scale-[1.02]"
                              {...field} 
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="animate-fade-in" style={{ animationDelay: "0.3s", animationFillMode: "both" }}>
                  <FormField
                    control={form1.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-primary" />
                          Email
                        </FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="correo@ejemplo.com" 
                            type="email"
                            className="transition-all duration-300 focus:scale-[1.02]"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="animate-fade-in" style={{ animationDelay: "0.4s", animationFillMode: "both" }}>
                  <Button 
                    type="submit" 
                    className="w-full group relative overflow-hidden"
                    size="lg"
                  >
                    <span className="relative z-10">Siguiente</span>
                    <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary-foreground/10 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                  </Button>
                </div>
              </form>
            </Form>
          ) : (
            <Form {...form2} key="form-step-2">
              <form onSubmit={form2.handleSubmit(onStep2Submit)} className="space-y-6">
                <div className="animate-fade-in">
                  <FormField
                    control={form2.control}
                    name="website"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Globe className="w-4 h-4 text-primary" />
                          URL del Sitio Web
                        </FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="www.ejemplo.com" 
                            type="url"
                            className="transition-all duration-300 focus:scale-[1.02]"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex gap-4 animate-fade-in" style={{ animationDelay: "0.1s", animationFillMode: "both" }}>
                  <Button 
                    type="button"
                    variant="outline"
                    onClick={() => setStep(1)}
                    className="flex-1 hover:scale-[1.02] transition-transform"
                    size="lg"
                  >
                    Atrás
                  </Button>
                  <Button 
                    type="submit" 
                    className="flex-1 group relative overflow-hidden"
                    size="lg"
                  >
                    <span className="relative z-10">Siguiente</span>
                    <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary-foreground/10 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </div>
      </div>
    </section>
  );
}
