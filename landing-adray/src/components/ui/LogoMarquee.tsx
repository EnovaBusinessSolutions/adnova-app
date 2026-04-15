"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { pub } from "@/lib/paths";

interface LogoMarqueeProps {
    className?: string;
}

const logos = [
    { name: "Meta Ads", icon: pub("/images/svg/meta.svg") },
    { name: "Google Ads", icon: pub("/images/svg/google-ads.svg") },
    { name: "Google Analytics", icon: pub("/images/svg/ga4.svg") },
    { name: "Shopify", icon: pub("/images/svg/shopify.svg") },
    { name: "ChatGPT", icon: pub("/images/svg/chatgpt.svg") },
    { name: "Claude", icon: pub("/images/svg/claude.svg") },
    { name: "Gemini", icon: pub("/images/svg/gemini.svg") },
    { name: "Copilot", icon: pub("/images/svg/copilot.svg") },
    { name: "Grok", icon: pub("/images/svg/grok.svg") },
    { name: "DeepSeek", icon: pub("/images/svg/deepseek.svg") },
];

export default function LogoMarquee({ className }: LogoMarqueeProps) {
    return (
        <div className={cn("overflow-hidden py-8", className)}>
            <div className="flex animate-marquee whitespace-nowrap">
                {[...logos, ...logos].map((logo, i) => (
                    <div
                        key={i}
                        className="mx-8 flex items-center gap-3 min-w-[140px] opacity-40"
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={logo.icon}
                            alt={logo.name}
                            className="w-5 h-5 object-contain"
                            style={{ filter: "brightness(0) invert(1)" }}
                        />
                        <span className="text-white-90 text-sm font-semibold tracking-wide whitespace-nowrap select-none" style={{ fontFamily: "var(--font-brand)" }}>
                            {logo.name}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
