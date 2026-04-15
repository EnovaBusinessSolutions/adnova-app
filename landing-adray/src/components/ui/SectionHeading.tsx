import React from "react";
import { cn } from "@/lib/utils";

interface SectionHeadingProps {
    tag?: string;
    tagIcon?: React.ReactNode;
    title: string;
    subtitle?: React.ReactNode;
    className?: string;
    titleClassName?: string;
    align?: "left" | "center";
}

export default function SectionHeading({
    tag,
    tagIcon,
    title,
    subtitle,
    className,
    titleClassName,
    align = "center",
}: SectionHeadingProps) {
    return (
        <div
            className={cn(
                "max-w-3xl mb-20",
                align === "center" && "mx-auto text-center",
                className
            )}
        >
            {tag && (
                <div className="flex items-center gap-3 mb-6 w-full">
                    {tagIcon && (
                        <span className="w-6 h-6 text-ad-tag shrink-0 opacity-80">{tagIcon}</span>
                    )}
                    <span className="t-p-sm uppercase tracking-widest text-ad-tag">
                        {tag}
                    </span>
                    <div className="tag-line" />
                </div>
            )}
            <h2
                className={cn("t-h2 text-white-90", titleClassName)}
                dangerouslySetInnerHTML={{ __html: title }}
            />
            {subtitle && (
                <p className="mt-4 t-p-lg text-ad-subtitle">
                    {subtitle}
                </p>
            )}
        </div>
    );
}
