import React from "react";
import { cn } from "@/lib/utils";

interface BadgeProps {
    children: React.ReactNode;
    className?: string;
}

export default function Badge({ children, className }: BadgeProps) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full t-p-sm",
                "bg-white-7 text-white-90",
                className
            )}
        >
            {children}
        </span>
    );
}
