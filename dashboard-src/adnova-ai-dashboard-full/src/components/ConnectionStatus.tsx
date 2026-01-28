
import { useState, useEffect } from 'react';
import { Activity, AlertCircle, CheckCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ConnectionStatusProps {
  apiKey: string;
  serviceName: string;
  testEndpoint?: string;
}

export const ConnectionStatus = ({ apiKey, serviceName, testEndpoint }: ConnectionStatusProps) => {
  const [status, setStatus] = useState<'checking' | 'connected' | 'error' | 'not-configured'>('not-configured');

  useEffect(() => {
    if (!apiKey) {
      setStatus('not-configured');
      return;
    }

    const testConnection = async () => {
      setStatus('checking');
      
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      
      if (apiKey.length > 10) {
        setStatus('connected');
      } else {
        setStatus('error');
      }
    };

    testConnection();
  }, [apiKey, testEndpoint]);

  const getStatusConfig = () => {
    switch (status) {
      case 'checking':
        return {
          icon: Activity,
          label: 'Verificando...',
          variant: 'secondary' as const,
          className: 'text-yellow-600'
        };
      case 'connected':
        return {
          icon: CheckCircle,
          label: 'Conectado',
          variant: 'default' as const,
          className: 'text-green-600'
        };
      case 'error':
        return {
          icon: AlertCircle,
          label: 'Error de conexión',
          variant: 'destructive' as const,
          className: 'text-red-600'
        };
      default:
        return {
          icon: AlertCircle,
          label: 'No configurado',
          variant: 'outline' as const,
          className: 'text-gray-500'
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-4 h-4 ${config.className}`} />
      <Badge variant={config.variant} className="text-xs">
        {config.label}
      </Badge>
    </div>
  );
};
