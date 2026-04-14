import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Calendar, Video, Link2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Confirmation() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/30 py-20">
      <div className="container mx-auto px-4 max-w-3xl">
        <Card className="border-2 shadow-2xl">
          <CardContent className="p-8 md:p-12 space-y-8">
            {/* Success Icon */}
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-accent/20 mb-6">
                <CheckCircle className="w-12 h-12 text-accent" />
              </div>
              
              <h1 className="text-4xl font-bold text-foreground mb-4">
                🎉 ¡Tu auditoría está confirmada!
              </h1>
              
              <p className="text-xl text-muted-foreground mb-2">
                Te esperamos el <span className="font-bold text-foreground">[día y hora]</span>
              </p>
              
              <p className="text-lg text-muted-foreground">
                Antes de la llamada, conecta tus cuentas para que la IA analice tus datos.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="space-y-4">
              <Button 
                size="lg" 
                className="w-full text-lg py-6 bg-primary hover:bg-primary/90"
                onClick={() => navigate('/onboarding')}
              >
                <Link2 className="w-5 h-5 mr-2" />
                Ver video y conectar cuentas
              </Button>
              
              <Button 
                size="lg" 
                variant="outline"
                className="w-full text-lg py-6"
                onClick={() => window.open('https://zoom.us/j/your-meeting-id', '_blank')}
              >
                <Video className="w-5 h-5 mr-2" />
                Abrir mi enlace de Zoom
              </Button>
            </div>

            {/* What's Next */}
            <div className="border-t pt-8 space-y-4">
              <h2 className="text-2xl font-bold text-foreground mb-4">
                Qué sucede ahora:
              </h2>
              
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <p className="text-muted-foreground">
                    Recibirás un email de confirmación con el enlace de la reunión
                  </p>
                </div>
                
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <p className="text-muted-foreground">
                    Te enviaremos recordatorios por WhatsApp 24h y 1h antes
                  </p>
                </div>
                
                <div className="flex items-start gap-3">
                  <Video className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <p className="text-muted-foreground">
                    Si conectas tus cuentas, tendrás un reporte personalizado listo en la llamada
                  </p>
                </div>
              </div>
            </div>

            {/* Back to Home */}
            <div className="text-center pt-4">
              <Button 
                variant="ghost"
                onClick={() => navigate('/')}
              >
                Volver al inicio
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
