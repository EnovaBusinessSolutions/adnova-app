
import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";

export interface OnboardingProgressProps {
  isAnalyzing: boolean;
  onComplete: () => void;
}

const analyzingSteps = [
  "Analyzing store structure...",
  "Checking product data...",
  "Scanning conversion funnel...",
  "Verifying tracking pixels...",
  "Analyzing SEO performance...",
  "Checking site speed metrics...",
  "Reviewing customer journey...",
  "Analyzing cart abandonment...",
  "Finalizing recommendations...",
];

export function OnboardingProgress({ isAnalyzing, onComplete }: OnboardingProgressProps) {
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  
  useEffect(() => {
    if (!isAnalyzing) return;
    
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          onComplete();
          return 100;
        }
        return prev + 1;
      });
      
      if (progress > 0 && progress % 11 === 0 && currentStep < analyzingSteps.length - 1) {
        setCurrentStep((prev) => prev + 1);
      }
    }, 100);
    
    return () => clearInterval(interval);
  }, [isAnalyzing, progress, currentStep, onComplete]);
  
  return (
    <div className="space-y-6 w-full max-w-md">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Analyzing your store</h2>
        <p className="text-muted-foreground mt-2">
          This will take just a minute
        </p>
      </div>
      
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>{progress}% complete</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>
      
      <div className="border border-border rounded-lg p-4 bg-muted/30">
        <p className="text-sm font-medium animate-pulse-opacity">
          {analyzingSteps[currentStep]}
        </p>
      </div>
      
      <p className="text-center text-sm text-muted-foreground">
        We're scanning your store to find optimization opportunities
      </p>
    </div>
  );
}
