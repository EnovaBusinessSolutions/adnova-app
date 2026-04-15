
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ShoppingBag, Mail, Facebook } from "lucide-react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    // Simular inicio de sesión
    setTimeout(() => {
      setIsLoading(false);
      toast({
        title: "Éxito",
        description: "Has iniciado sesión correctamente.",
      });
      navigate("/onboarding");
    }, 1500);
  };

  const handleOAuthLogin = (provider: string) => {
    setIsLoading(true);
    
    // Simular inicio de sesión OAuth
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
    <div className="space-y-6 w-full max-w-md">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Bienvenido de nuevo</h1>
        <p className="text-muted-foreground mt-2">
          Inicia sesión en tu cuenta para continuar
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input
            id="email"
            placeholder="hola@ejemplo.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Contraseña</Label>
            <a href="#" className="text-xs text-primary hover:underline">
              ¿Olvidaste tu contraseña?
            </a>
          </div>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button
          type="submit"
          className="w-full"
          variant="gradient"
          disabled={isLoading}
        >
          {isLoading ? "Iniciando sesión..." : "Iniciar sesión"}
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border"></div>
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            O continuar con
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Button
          variant="outline"
          onClick={() => handleOAuthLogin("Google")}
          disabled={isLoading}
          className="w-full"
        >
          <Mail className="mr-2 h-4 w-4" />
          Google
        </Button>
        <Button
          variant="outline"
          onClick={() => handleOAuthLogin("Facebook")}
          disabled={isLoading}
          className="w-full"
        >
          <Facebook className="mr-2 h-4 w-4" />
          Meta
        </Button>
        <Button
          variant="outline"
          onClick={() => handleOAuthLogin("Shopify")}
          disabled={isLoading}
          className="w-full"
        >
          <ShoppingBag className="mr-2 h-4 w-4" />
          Shopify
        </Button>
      </div>

      <div className="text-center text-sm">
        <span className="text-muted-foreground">¿No tienes una cuenta?</span>{" "}
        <a href="#" className="text-primary hover:underline">
          Regístrate
        </a>
      </div>
    </div>
  );
}
