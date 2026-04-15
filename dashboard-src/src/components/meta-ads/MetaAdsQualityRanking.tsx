
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CheckCircle, XCircle, TrendingUp, Target, Users } from "lucide-react";

const qualityMetrics = [
  {
    metric: "Quality Ranking",
    score: 8.5,
    status: "Bueno",
    icon: CheckCircle,
    color: "text-green-500",
    description: "Calidad general del anuncio vs competencia"
  },
  {
    metric: "Engagement Rate Ranking",
    score: 7.2,
    status: "Promedio",
    icon: Users,
    color: "text-yellow-500",
    description: "Nivel de interacción comparado con anuncios similares"
  },
  {
    metric: "Conversion Rate Ranking",
    score: 9.1,
    status: "Excelente",
    icon: Target,
    color: "text-green-500",
    description: "Efectividad de conversión vs competidores"
  },
];

const diagnostics = [
  {
    issue: "Frecuencia Alta",
    severity: "warning",
    description: "Algunos usuarios ven el anuncio demasiado seguido",
    impact: "Puede reducir efectividad y aumentar costos",
    solution: "Ampliar audiencia o reducir presupuesto"
  },
  {
    issue: "CTR por Debajo del Promedio",
    severity: "error",
    description: "El CTR está 15% por debajo del benchmark",
    impact: "Reduce el ranking de calidad y aumenta costos",
    solution: "Optimizar creatividades y copy del anuncio"
  },
  {
    issue: "Audiencia Saturada",
    severity: "warning",
    description: "La audiencia ha visto el anuncio múltiples veces",
    impact: "Disminución en performance y engagement",
    solution: "Crear nuevas creatividades o expandir targeting"
  },
];

export const MetaAdsQualityRanking = () => {
  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "error": return <XCircle className="w-4 h-4 text-red-500" />;
      case "warning": return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      default: return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "error": return "destructive";
      case "warning": return "secondary";
      default: return "default";
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Quality Rankings */}
      <Card className="glass-effect">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Quality Rankings
          </CardTitle>
          <CardDescription>
            Indicadores de calidad comparados con la competencia
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {qualityMetrics.map((metric, index) => (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <metric.icon className={`w-4 h-4 ${metric.color}`} />
                  <span className="font-medium text-foreground">{metric.metric}</span>
                </div>
                <Badge variant={metric.status === "Excelente" ? "default" : metric.status === "Bueno" ? "secondary" : "outline"}>
                  {metric.status}
                </Badge>
              </div>
              <Progress value={metric.score * 10} className="h-2" />
              <p className="text-sm text-muted-foreground">{metric.description}</p>
              <div className="text-right">
                <span className="text-lg font-bold text-foreground">{metric.score}/10</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Diagnostics */}
      <Card className="glass-effect">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-primary" />
            Diagnósticos y Recomendaciones
          </CardTitle>
          <CardDescription>
            Problemas identificados y sugerencias de optimización
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {diagnostics.map((diagnostic, index) => (
            <div key={index} className="border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getSeverityIcon(diagnostic.severity)}
                  <h4 className="font-medium text-foreground">{diagnostic.issue}</h4>
                </div>
                <Badge variant={getSeverityColor(diagnostic.severity) as any}>
                  {diagnostic.severity === "error" ? "Crítico" : "Atención"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{diagnostic.description}</p>
              <div className="bg-muted/50 rounded p-3 space-y-2">
                <p className="text-sm font-medium text-foreground">Impacto:</p>
                <p className="text-sm text-muted-foreground">{diagnostic.impact}</p>
                <p className="text-sm font-medium text-foreground">Solución:</p>
                <p className="text-sm text-muted-foreground">{diagnostic.solution}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};
