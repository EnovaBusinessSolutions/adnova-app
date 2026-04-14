import React from "react";
import { cn } from "@/lib/utils";

interface CardProps {
    children: React.ReactNode;
    className?: string;
    hover?: boolean;
}

export default function Card({
    children,
    className,
    hover = true,
}: CardProps) {
    return (
        <div
            className={cn(
                "card p-6 transition-all duration-300",
                hover && "hover:-translate-y-1",
                className
            )}
        >
            {children}
        </div>
    );
}
