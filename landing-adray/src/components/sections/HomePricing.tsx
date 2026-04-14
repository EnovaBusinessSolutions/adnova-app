"use client";

import React from "react";
import { Check } from "lucide-react";
import Container from "@/components/ui/Container";
import SectionHeading from "@/components/ui/SectionHeading";
import Button from "@/components/ui/Button";
import AnimatedSection from "@/components/ui/AnimatedSection";
import { pub } from "@/lib/paths";

const plans: Array<{
    name: string;
    monthlyPrice: number | null;
    subtitle: string | null;
    features: string[];
    trust: string | null;
    cta: string;
    ctaHref: string;
    bgImage: string;
}> = [
    {
        name: "Free",
        monthlyPrice: 0,
        subtitle: null,
        features: [
            "Meta, Google Ads, and GA4 connectors",
            "Daily Signal PDF",
            "Works in any AI",
            "Pre-built prompt library",
            "60-day rolling data window",
            "Unlimited seats",
        ],
        trust: null,
        cta: "Get Started Free",
        ctaHref: "/getstarted",
        bgImage:
            "https://framerusercontent.com/images/XXSw2JqvtikgOcaexTTozzVsO54.webp",
    },
    {
        name: "Pro",
        monthlyPrice: 49,
        subtitle: "+ 0.3% of ad spend (capped at $2,000/mo)",
        features: [
            "Everything in Free",
            "Unlimited data history",
            "Priority support",
            "Early MCP access (Q2 2026)",
            "Additional workspaces: $25/mo each",
        ],
        trust: null,
        cta: "Start Pro",
        ctaHref: "/contact",
        bgImage:
            "https://framerusercontent.com/images/4fEwCxLuKCW6ZaczMzoeCElmzBg.webp",
    },
    {
        name: "Enterprise",
        monthlyPrice: null,
        subtitle: "Custom pricing for teams at scale.",
        features: [
            "Custom onboarding",
            "30–60 day invoicing",
            "Dedicated support",
            "SLA",
            "Volume pricing",
        ],
        trust: null,
        cta: "Talk to Us",
        ctaHref: "/contact",
        bgImage:
            "https://framerusercontent.com/images/K53jEm1inmwk6lcSyDVU5W7rvLM.webp",
    },
];

export default function HomePricing() {
    return (
        <section className="py-20 relative">
            <Container>
                <AnimatedSection>
                    <SectionHeading
                        tag="PRICING"
                        tagIcon={
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={pub("/images/svg/3UovOTKirX07vhyWYJGSliEt1E4.svg")}
                                alt=""
                                width={24}
                                height={24}
                            />
                        }
                        title="Free to start. Built to scale."
                        subtitle="No dashboards to pay for. Just your data, ready for AI."
                        titleClassName="text-white-100"
                    />
                </AnimatedSection>

                {/* Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {plans.map((plan, i) => (
                        <AnimatedSection key={plan.name} delay={i * 0.12}>
                            <div className="card relative overflow-hidden h-full flex flex-col">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={plan.bgImage}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                                    style={{ filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                                />
                                <div className="relative z-10 p-8 flex flex-col h-full">
                                    <h3 className="t-h4 text-white-90">{plan.name}</h3>

                                    {plan.monthlyPrice !== null ? (
                                        <div className="mt-3 flex items-baseline gap-1">
                                            <span className="text-4xl font-bold text-white-90">
                                                ${plan.monthlyPrice}
                                            </span>
                                            <span className="text-ad-muted t-p-sm">
                                                /month
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="mt-3">
                                            <p className="t-h4 text-gradient">Custom</p>
                                        </div>
                                    )}

                                    {plan.subtitle && (
                                        <p className="mt-2 t-p-sm text-ad-muted">
                                            {plan.subtitle}
                                        </p>
                                    )}
                                    {!plan.subtitle && (
                                        <div className="mt-2 t-p-sm">&nbsp;</div>
                                    )}

                                    <div className={`${plan.monthlyPrice === null ? "mt-8" : "mt-6"} mb-8`}>
                                        <Button
                                            variant="primary"
                                            href={plan.ctaHref}
                                            className="w-full whitespace-nowrap min-h-[48px]"
                                        >
                                            {plan.cta}
                                        </Button>
                                    </div>

                                    <ul className="space-y-3">
                                        {plan.features.map((feat) => (
                                            <li key={feat} className="flex items-start gap-3">
                                                <span
                                                        className="w-5 h-5 rounded-full bg-white-10 flex items-center justify-center shrink-0 mt-0.5"
                                                    style={{
                                                        boxShadow:
                                                            "inset 0 0 0 1px rgba(62,40,111,0.6)",
                                                    }}
                                                >
                                                    <Check size={10} className="text-white-100" />
                                                </span>
                                                <span className="t-p-sm text-white-90">{feat}</span>
                                            </li>
                                        ))}
                                    </ul>

                                    {plan.trust && (
                                        <p className="mt-6 t-p-sm text-ad-muted text-center">
                                            {plan.trust}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </AnimatedSection>
                    ))}
                </div>
            </Container>
        </section>
    );
}
