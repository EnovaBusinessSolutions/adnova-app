
// Este archivo debe ser reemplazado ya que está causando confusión con el sistema de toasts
import { useToast as useHookToast, toast } from "@/hooks/use-toast";

// Re-exportamos desde la ubicación correcta
export { useHookToast as useToast, toast };
