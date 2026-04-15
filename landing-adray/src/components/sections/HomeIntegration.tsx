"use client";

import React from "react";
import Container from "@/components/ui/Container";
import SectionHeading from "@/components/ui/SectionHeading";
import Button from "@/components/ui/Button";
import AnimatedSection from "@/components/ui/AnimatedSection";
import { brandify } from "@/lib/utils";
import { pub } from "@/lib/paths";

const claudeMaskUrl = pub("/images/svg/claude.svg");
const deepseekMaskUrl = pub("/deepseek-icon.svg");

const integrationIcons = [
    {
        label: "OpenAI",
        svg: (
            <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
                <path d="M22.28 9.37a5.93 5.93 0 0 0-.51-4.89 6.01 6.01 0 0 0-6.47-2.9A5.93 5.93 0 0 0 10.83 0a6.01 6.01 0 0 0-5.73 4.14 5.93 5.93 0 0 0-3.97 2.88 6.01 6.01 0 0 0 .74 7.04 5.93 5.93 0 0 0 .51 4.89 6.01 6.01 0 0 0 6.47 2.9A5.93 5.93 0 0 0 13.32 24a6.01 6.01 0 0 0 5.73-4.14 5.93 5.93 0 0 0 3.97-2.88 6.01 6.01 0 0 0-.74-7.04ZM13.32 22.5a4.47 4.47 0 0 1-2.87-1.04l.14-.08 4.77-2.76a.78.78 0 0 0 .39-.67v-6.73l2.02 1.16a.07.07 0 0 1 .04.06v5.58a4.49 4.49 0 0 1-4.49 4.49ZM3.61 18.36a4.47 4.47 0 0 1-.53-3.01l.14.08 4.77 2.76a.78.78 0 0 0 .78 0l5.83-3.37v2.33a.07.07 0 0 1-.03.06l-4.83 2.79a4.49 4.49 0 0 1-6.14-1.64ZM2.34 7.89A4.47 4.47 0 0 1 4.68 5.9v5.69a.78.78 0 0 0 .39.67l5.83 3.37-2.02 1.16a.07.07 0 0 1-.07 0L4 13.99a4.49 4.49 0 0 1-1.64-6.1Zm17.17 4-5.83-3.37 2.02-1.16a.07.07 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.69 8.1v-5.69a.78.78 0 0 0-.39-.67ZM21.5 8.65l-.14-.08-4.77-2.76a.78.78 0 0 0-.78 0l-5.83 3.37V6.85a.07.07 0 0 1 .03-.06l4.83-2.79a4.49 4.49 0 0 1 6.67 4.65ZM8.33 13.37l-2.02-1.16a.07.07 0 0 1-.04-.06V6.56a4.49 4.49 0 0 1 7.37-3.45l-.14.08-4.77 2.76a.78.78 0 0 0-.39.67v6.73ZM9.42 11l2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3Z" />
            </svg>
        ),
    },
    {
        label: "Anthropic",
        svg: (
            <div
                className="h-9 w-9 bg-white"
                style={{
                    maskImage: `url('${claudeMaskUrl}')`,
                    WebkitMaskImage: `url('${claudeMaskUrl}')`,
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskPosition: "center",
                    WebkitMaskPosition: "center",
                    maskSize: "contain",
                    WebkitMaskSize: "contain",
                }}
            />
        ),
    },
    {
        label: "Google Gemini",
        svg: (
            <svg viewBox="0 0 24 24" width="36" height="36">
                <defs>
                    <linearGradient id="gemGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#CA8AE5" />
                        <stop offset="1" stopColor="#3E286F" />
                    </linearGradient>
                </defs>
                <path d="M12 24c0-6.63-5.37-12-12-12C6.63 12 12 6.63 12 0c0 6.63 5.37 12 12 12-6.63 0-12 5.37-12 12Z" fill="url(#gemGrad)" />
            </svg>
        ),
    },
    {
        label: "xAI Grok",
        svg: (
            <div
                className="h-9 w-9 bg-white"
                style={{
                    maskImage: `url('${pub("/images/svg/grok.svg")}')`,
                    WebkitMaskImage: `url('${pub("/images/svg/grok.svg")}')`,
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskPosition: "center",
                    WebkitMaskPosition: "center",
                    maskSize: "contain",
                    WebkitMaskSize: "contain",
                }}
            />
        ),
    },
    {
        label: "DeepSeek",
        svg: (
            <div
                className="h-9 w-9 bg-white"
                style={{
                    maskImage: `url('${deepseekMaskUrl}')`,
                    WebkitMaskImage: `url('${deepseekMaskUrl}')`,
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskPosition: "center",
                    WebkitMaskPosition: "center",
                    maskSize: "contain",
                    WebkitMaskSize: "contain",
                }}
            />
        ),
    },
    {
        label: "Meta AI",
        svg: (
            <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm4.64 14.19c-.42.72-1.02 1.06-1.64 1.06-.64 0-1.18-.38-1.64-1.18L12 13.6l-1.36 2.47c-.46.8-1 1.18-1.64 1.18-.62 0-1.22-.34-1.64-1.06-.58-1-1.06-2.9-1.06-4.48 0-1.7.56-2.71 1.5-2.71.78 0 1.42.62 2.14 1.86l1.06 1.82 1.06-1.82c.72-1.24 1.36-1.86 2.14-1.86.94 0 1.5 1.01 1.5 2.71 0 1.58-.48 3.48-1.06 4.48Z" />
            </svg>
        ),
    },
];

export default function HomeIntegration() {
    return (
        <section className="py-20 relative overflow-hidden">
            {/* Background masking gradient */}
            <div
                className="absolute inset-0 opacity-40 pointer-events-none"
                style={{
                    backgroundImage:
                        "url(https://framerusercontent.com/images/FMpJMmyNTqRd8oGYputAzs8cso.webp)",
                    backgroundSize: "110% auto",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "35% center",
                    filter: "sepia(1) hue-rotate(230deg) saturate(2)",
                }}
            />

            <Container className="relative z-10">
                <AnimatedSection>
                    <SectionHeading
                        tag="INTEGRATION"
                        tagIcon={
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={pub("/images/svg/A2kRK4SXq8SQGtD1igJ3QJKmUH4.svg")}
                                alt=""
                                width={24}
                                height={24}
                            />
                        }
                        title="Connect Everything, Analyze Anywhere."
                        subtitle={brandify("Adray connects your ad platforms and ecommerce store then reconciles and packs your data into a Signal you can use on any AI.")}
                        titleClassName="text-white-100"
                        className="[&>div:first-child]:justify-center [&_.tag-line]:hidden"
                    />
                </AnimatedSection>

                {/* Integration icon grid */}
                <AnimatedSection delay={0.2}>
                    <div className="flex flex-wrap items-center justify-center gap-6 mb-12">
                        {integrationIcons.map((icon, i) => (
                            <div
                                key={i}
                                className="w-20 h-20 rounded-[24px] flex items-center justify-center"
                                style={{
                                    background:
                                        "linear-gradient(40deg, rgb(181,92,255) 0%, rgb(15,11,20) 45%, rgb(202,138,229) 100%)",
                                    boxShadow: "0px 6px 24px 0px rgba(181,92,255,0.25)",
                                }}
                            >
                                <div className="w-[72px] h-[72px] rounded-[20px] bg-ad-surface flex items-center justify-center" title={icon.label}>
                                    {icon.svg}
                                </div>
                            </div>
                        ))}
                    </div>
                </AnimatedSection>

                <AnimatedSection delay={0.3}>
                    <div className="text-center">
                        <Button variant="primary" href="/login">
                            Get Started Free
                        </Button>
                    </div>
                </AnimatedSection>
            </Container>
        </section>
    );
}
