import React from "react";
import { cn } from "@/lib/utils";

interface ContainerProps {
    children: React.ReactNode;
    className?: string;
    as?: React.ElementType;
}

export default function Container({
    children,
    className,
    as: Component = "div",
}: ContainerProps) {
    return (
        <Component className={cn("mx-auto w-full max-w-[1200px] px-5 md:px-10", className)}>
            {children}
        </Component>
    );
}
