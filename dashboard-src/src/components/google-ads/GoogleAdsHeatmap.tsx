
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const heatmapData = [
  { day: "Lun", hours: [12, 15, 18, 22, 25, 28, 32, 35, 42, 38, 35, 28, 25, 22, 18, 15, 12, 8, 5, 3, 2, 1, 1, 2] },
  { day: "Mar", hours: [8, 12, 15, 18, 22, 25, 28, 32, 38, 42, 45, 40, 35, 30, 28, 25, 20, 15, 12, 8, 5, 3, 2, 1] },
  { day: "Mié", hours: [10, 14, 17, 20, 24, 27, 30, 35, 40, 45, 48, 42, 38, 32, 28, 25, 22, 18, 15, 12, 8, 5, 3, 2] },
  { day: "Jue", hours: [15, 18, 22, 25, 28, 32, 35, 40, 45, 50, 52, 48, 42, 38, 35, 30, 25, 20, 15, 12, 8, 5, 3, 2] },
  { day: "Vie", hours: [20, 25, 28, 32, 35, 38, 42, 48, 52, 55, 58, 52, 48, 42, 38, 35, 30, 25, 20, 15, 12, 8, 5, 3] },
  { day: "Sáb", hours: [5, 8, 12, 15, 18, 22, 25, 28, 32, 35, 38, 35, 32, 28, 25, 22, 18, 15, 12, 8, 5, 3, 2, 1] },
  { day: "Dom", hours: [3, 5, 8, 12, 15, 18, 22, 25, 28, 30, 32, 28, 25, 22, 18, 15, 12, 8, 5, 3, 2, 1, 1, 1] },
];

const hours = Array.from({ length: 24 }, (_, i) => i);

export const GoogleAdsHeatmap = () => {
  const getIntensityColor = (value: number) => {
    const intensity = Math.min(value / 60, 1); 
    const opacity = Math.max(0.1, intensity);
    
    if (intensity > 0.8) return `bg-green-500 opacity-${Math.round(opacity * 100)}`;
    if (intensity > 0.6) return `bg-yellow-500 opacity-${Math.round(opacity * 100)}`;
    if (intensity > 0.4) return `bg-orange-500 opacity-${Math.round(opacity * 100)}`;
    if (intensity > 0.2) return `bg-red-400 opacity-${Math.round(opacity * 100)}`;
    return `bg-gray-300 opacity-${Math.round(opacity * 100)}`;
  };

  return (
    <Card className="border-2 rounded-2xl shadow-sm">
      <CardHeader>
        <CardTitle>Heatmap de Rendimiento</CardTitle>
        <p className="text-sm text-muted-foreground">
          Conversiones por hora y día de la semana
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {/* Hour labels */}
          <div className="grid grid-cols-25 gap-1 text-xs text-muted-foreground">
            <div></div>
            {hours.map(hour => (
              <div key={hour} className="text-center">
                {hour % 4 === 0 ? hour : ''}
              </div>
            ))}
          </div>
          
          {/* Heatmap grid */}
          {heatmapData.map((day, dayIndex) => (
            <div key={dayIndex} className="grid grid-cols-25 gap-1 items-center">
              <div className="text-sm font-medium text-muted-foreground w-12">
                {day.day}
              </div>
              {day.hours.map((value, hourIndex) => (
                <div
                  key={hourIndex}
                  className={`h-6 w-full rounded ${getIntensityColor(value)} border`}
                  title={`${day.day} ${hourIndex}:00 - ${value} conversiones`}
                />
              ))}
            </div>
          ))}
        </div>
        
        {/* Legend */}
        <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
          <span>Menos conversiones</span>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 bg-gray-300 rounded"></div>
            <div className="h-3 w-3 bg-red-400 rounded"></div>
            <div className="h-3 w-3 bg-orange-500 rounded"></div>
            <div className="h-3 w-3 bg-yellow-500 rounded"></div>
            <div className="h-3 w-3 bg-green-500 rounded"></div>
          </div>
          <span>Más conversiones</span>
        </div>
      </CardContent>
    </Card>
  );
};
