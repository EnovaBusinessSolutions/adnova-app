
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepProps {
  title: string;
  description: string;
}

export interface ProgressStepperProps {
  steps: StepProps[];
  currentStep: number;
}

export function ProgressStepper({ steps, currentStep }: ProgressStepperProps) {
  return (
    <div className="space-y-4">
      {steps.map((step, index) => {
        const status =
          index < currentStep
            ? "completed"
            : index === currentStep
            ? "active"
            : "upcoming";

        return (
          <div key={index} className="flex items-start gap-4">
            <div
              className={cn(
                "onboarding-step-indicator",
                status === "active" && "onboarding-step-active",
                status === "completed" && "onboarding-step-completed",
                status === "upcoming" && "onboarding-step-upcoming"
              )}
            >
              {status === "completed" ? (
                <CheckIcon className="h-4 w-4" />
              ) : (
                index + 1
              )}
            </div>
            <div className="space-y-1">
              <p
                className={cn(
                  "font-medium",
                  status === "active" && "text-foreground",
                  status === "completed" && "text-shopify",
                  status === "upcoming" && "text-muted-foreground"
                )}
              >
                {step.title}
              </p>
              <p
                className={cn(
                  "text-sm",
                  status === "upcoming" && "text-muted-foreground"
                )}
              >
                {step.description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
