
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

export default function Settings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [storeSettings, setStoreSettings] = useState({
    storeName: "Mi Tienda Shopify",
    storeUrl: "https://mi-tienda.myshopify.com",
    emailNotifications: true,
    dailyReports: false,
    darkMode: true,
    autoFix: false
  });

  const handleSettingsChange = (key: string, value: any) => {
    setStoreSettings({
      ...storeSettings,
      [key]: value
    });
  };

  const handleSaveSettings = () => {
    setLoading(true);
    
    // Simulación de guardado
    setTimeout(() => {
      setLoading(false);
      toast({
        title: "Configuración guardada",
        description: "Tus cambios han sido guardados exitosamente.",
        variant: "default", // Cambiado de "success" a "default"
      });
    }, 800);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground">
          Gestiona la configuración de tu cuenta y preferencias de la aplicación.
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="bg-sidebar-accent">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="tienda">Tienda</TabsTrigger>
          <TabsTrigger value="notificaciones">Notificaciones</TabsTrigger>
          <TabsTrigger value="integraciones">Integraciones</TabsTrigger>
        </TabsList>
        
        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Configuración General</CardTitle>
              <CardDescription>
                Configura las preferencias generales de la aplicación ADNOVA.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="darkMode">Modo Oscuro</Label>
                  <p className="text-sm text-muted-foreground">
                    Activa el modo oscuro para la interfaz de la aplicación.
                  </p>
                </div>
                <Switch
                  id="darkMode"
                  checked={storeSettings.darkMode}
                  onCheckedChange={(checked) => handleSettingsChange("darkMode", checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="autoFix">Corrección Automática</Label>
                  <p className="text-sm text-muted-foreground">
                    Permite que ADNOVA corrija automáticamente los problemas detectados.
                  </p>
                </div>
                <Switch
                  id="autoFix"
                  checked={storeSettings.autoFix}
                  onCheckedChange={(checked) => handleSettingsChange("autoFix", checked)}
                />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Cuenta</CardTitle>
              <CardDescription>
                Actualiza la información de tu cuenta.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <Label htmlFor="name">Nombre</Label>
                <Input id="name" defaultValue="Juan Pérez" />
              </div>
              <div className="grid gap-3">
                <Label htmlFor="email">Email</Label>
                <Input id="email" defaultValue="juan@ejemplo.com" type="email" />
              </div>
              <Button onClick={handleSaveSettings} disabled={loading}>
                {loading ? "Guardando..." : "Guardar Cambios"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tienda" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Información de la Tienda</CardTitle>
              <CardDescription>
                Configura los detalles de tu tienda Shopify.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <Label htmlFor="storeName">Nombre de la Tienda</Label>
                <Input 
                  id="storeName" 
                  value={storeSettings.storeName}
                  onChange={(e) => handleSettingsChange("storeName", e.target.value)}
                />
              </div>
              <div className="grid gap-3">
                <Label htmlFor="storeUrl">URL de la Tienda</Label>
                <Input 
                  id="storeUrl" 
                  value={storeSettings.storeUrl}
                  onChange={(e) => handleSettingsChange("storeUrl", e.target.value)}
                />
              </div>
              <Button onClick={handleSaveSettings} disabled={loading}>
                {loading ? "Guardando..." : "Guardar Cambios"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notificaciones" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Preferencias de Notificaciones</CardTitle>
              <CardDescription>
                Configura cómo y cuándo quieres recibir notificaciones.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="emailNotif">Notificaciones por Email</Label>
                  <p className="text-sm text-muted-foreground">
                    Recibe alertas importantes por email.
                  </p>
                </div>
                <Switch
                  id="emailNotif"
                  checked={storeSettings.emailNotifications}
                  onCheckedChange={(checked) => handleSettingsChange("emailNotifications", checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="dailyReports">Informes Diarios</Label>
                  <p className="text-sm text-muted-foreground">
                    Recibe un resumen diario del rendimiento de tu tienda.
                  </p>
                </div>
                <Switch
                  id="dailyReports"
                  checked={storeSettings.dailyReports}
                  onCheckedChange={(checked) => handleSettingsChange("dailyReports", checked)}
                />
              </div>
              <Button onClick={handleSaveSettings} disabled={loading}>
                {loading ? "Guardando..." : "Guardar Cambios"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integraciones" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Integraciones de Plataformas</CardTitle>
              <CardDescription>
                Gestiona las conexiones con tus plataformas de marketing.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between border p-4 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-500 text-white p-2 rounded-full">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium">Facebook</p>
                      <p className="text-sm text-muted-foreground">ID: 123456789</p>
                    </div>
                  </div>
                  <Button variant="destructive" size="sm">Desconectar</Button>
                </div>

                <div className="flex items-center justify-between border p-4 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="bg-red-500 text-white p-2 rounded-full">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
                        <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium">Google Ads</p>
                      <p className="text-sm text-muted-foreground">ID: GA-12345</p>
                    </div>
                  </div>
                  <Button variant="destructive" size="sm">Desconectar</Button>
                </div>

                <div className="flex items-center justify-between border p-4 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="bg-black text-white p-2 rounded-full">
                      <span className="text-xs font-bold">TT</span>
                    </div>
                    <div>
                      <p className="font-medium">TikTok</p>
                      <p className="text-sm text-muted-foreground">No conectado</p>
                    </div>
                  </div>
                  <Button size="sm">Conectar</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
