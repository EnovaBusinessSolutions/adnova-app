
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { 
  ChevronLeft, 
  ChevronRight, 
  LayoutDashboard, 
  FileSearch, 
  Activity, 
  CalendarClock, 
  Settings
} from "lucide-react";

const NAV_ITEMS = [
  {
    title: "Panel",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Auditoría",
    href: "/audit",
    icon: FileSearch,
  },
  {
    title: "Verificador de Píxeles",
    href: "/pixel-verifier",
    icon: Activity,
  },
  {
    title: "Próximamente",
    href: "/coming-soon",
    icon: CalendarClock,
    disabled: true,
  },
  {
    title: "Configuración",
    href: "/settings",
    icon: Settings,
  },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <div
      className={cn(
        "h-screen border-r border-border bg-sidebar transition-all duration-300 flex flex-col",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className="p-4 flex items-center justify-between border-b border-border">
        {!collapsed && (
          <div className="font-bold text-xl">
            <span className="text-shopify">AD</span>
            <span>NOVA</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn("ml-auto", collapsed && "mx-auto")}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </Button>
      </div>

      <nav className="flex-grow py-4">
        <ul className="space-y-1 px-2">
          {NAV_ITEMS.map((item) => (
            <li key={item.title}>
              <Link
                to={item.disabled ? "#" : item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  location.pathname === item.href
                    ? "bg-sidebar-accent text-shopify"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                  item.disabled && "opacity-60 pointer-events-none cursor-not-allowed",
                  collapsed && "justify-center"
                )}
              >
                <item.icon size={18} />
                {!collapsed && <span>{item.title}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
            <span className="text-xs font-medium">JP</span>
          </div>
          {!collapsed && (
            <div className="flex-grow">
              <p className="text-sm font-medium truncate">Juan Pérez</p>
              <p className="text-xs text-muted-foreground truncate">juan@ejemplo.com</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
