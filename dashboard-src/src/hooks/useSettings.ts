
import { useState, useEffect } from 'react';
import { toast } from '@/hooks/use-toast';

export interface AppSettings {
  // Notifications
  emailNotifications: boolean;
  pushNotifications: boolean;
  weeklyReports: boolean;
  
  // Appearance
  theme: string;
  sidebarCollapsed: boolean;
  
  // Security
  twoFactorAuth: boolean;
  sessionTimeout: string;
  
  // Integrations
  webhookUrl: string;
  slackWebhook: string;
  discordWebhook: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  emailNotifications: true,
  pushNotifications: false,
  weeklyReports: true,
  theme: "dark",
  sidebarCollapsed: false,
  twoFactorAuth: false,
  sessionTimeout: "24",
  webhookUrl: "",
  slackWebhook: "",
  discordWebhook: ""
};

export const useSettings = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  
  useEffect(() => {
    const savedSettings = localStorage.getItem('appSettings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      } catch (error) {
        console.error('Error al cargar configuración:', error);
        toast({
          title: "Error",
          description: "No se pudo cargar la configuración guardada",
          variant: "destructive",
        });
      }
    }
  }, []);

  const updateSetting = (key: keyof AppSettings, value: any) => {
    setSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      setHasChanges(true);
      return newSettings;
    });
  };

  const validateSettings = (): boolean => {
    const errors: string[] = [];

   
    if (settings.webhookUrl && !isValidUrl(settings.webhookUrl)) {
      errors.push("URL de Webhook inválida");
    }
    if (settings.slackWebhook && !isValidUrl(settings.slackWebhook)) {
      errors.push("URL de Slack Webhook inválida");
    }
    if (settings.discordWebhook && !isValidUrl(settings.discordWebhook)) {
      errors.push("URL de Discord Webhook inválida");
    }

    if (errors.length > 0) {
      toast({
        title: "Errores de validación",
        description: errors.join(", "),
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const saveSettings = async (): Promise<boolean> => {
    if (!validateSettings()) {
      return false;
    }

    setIsLoading(true);
    
    try {
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      
      localStorage.setItem('appSettings', JSON.stringify(settings));
      
     
      applySettings(settings);
      
      setHasChanges(false);
      
      toast({
        title: "Configuración guardada",
        description: "Todas las configuraciones han sido guardadas exitosamente.",
      });
      
      return true;
    } catch (error) {
      console.error('Error al guardar configuración:', error);
      toast({
        title: "Error",
        description: "No se pudo guardar la configuración",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    setHasChanges(true);
    toast({
      title: "Configuración restablecida",
      description: "Se han restaurado los valores por defecto",
    });
  };

  return {
    settings,
    updateSetting,
    saveSettings,
    resetSettings,
    isLoading,
    hasChanges
  };
};

const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const applySettings = (settings: AppSettings) => {
 
  if (settings.theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  
  document.documentElement.lang = 'es';

  
  if (settings.pushNotifications && 'Notification' in window) {
    Notification.requestPermission();
  }

  console.log('Configuraciones aplicadas:', settings);
};
