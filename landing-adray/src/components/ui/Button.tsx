"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "ghost" | "outline";
    size?: "sm" | "md" | "lg";
    href?: string;
    children: React.ReactNode;
}

export default function Button({
    variant = "primary",
    size = "md",
    href,
    children,
    className,
    ...props
}: ButtonProps) {
    const base =
        "inline-flex items-center justify-center font-semibold rounded-[15px] transition-all duration-300 cursor-pointer";

    const variants = {
        primary:
            "bg-black-100 text-white-100 border border-white-40 glow-btn hover:scale-105",
        secondary:
            "bg-ad-surface text-white-100 border border-ad-deep hover:border-ad-muted/40 hover:scale-105",
        ghost:
            "bg-transparent text-gradient hover:opacity-80",
        outline:
            "bg-transparent border border-ad-deep text-white-90 hover:border-ad-muted hover:text-white-100 hover:scale-105",
    };

    const sizes = {
        sm: "px-4 py-2 text-sm",
        md: "px-6 py-3 text-sm tracking-[-0.02em]",
        lg: "px-6 py-3.5 text-base tracking-[-0.02em]",
    };

    const classes = cn(base, variants[variant], sizes[size], className);

    if (href) {
        return (
            <a href={href} className={classes}>
                {children}
            </a>
        );
    }

    return (
        <button className={classes} {...props}>
            {children}
        </button>
    );
}
