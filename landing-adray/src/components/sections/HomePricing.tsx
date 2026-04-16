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
        name: "Adray Signal",
        monthlyPrice: 0,
        subtitle: "Your entire marketing stack in your LLM and Looker Studio.",
        features: [
            "Daily Signal PDF delivered to your inbox — works in any AI",
            "Custom GPT for ChatGPT",
            "MCP connector for Claude (live now)",
            "Looker Studio connector (coming soon)",
            "Meta Ads · Google Ads · Google Analytics",
            "30-day rolling data · No credit card needed",
        ],
        trust: "Need unlimited history? $49/month",
        cta: "Get Started Free",
        ctaHref: "/login",
        bgImage:
            "https://framerusercontent.com/images/XXSw2JqvtikgOcaexTTozzVsO54.webp",
    },
    {
        name: "Adray Core",
        monthlyPrice: 0,
        subtitle: "Full attribution depth. Server-side intelligence. Built for performance.",
        features: [
            "Everything in Signal",
            "Adray pixel + CAPI enrichment",
            "Behavioral Revenue Intelligence (BRI)",
            "Attribution Deviation Modeling",
            "Server-side website data",
            "30-day rolling data · No credit card needed",
        ],
        trust: "Need unlimited history? $99/month + 1% ad spend",
        cta: "Get Started Free",
        ctaHref: "/login",
        bgImage:
            "https://framerusercontent.com/images/4fEwCxLuKCW6ZaczMzoeCElmzBg.webp",
    },
    {
        name: "Enterprise",
        monthlyPrice: null,
        subtitle: "For advertisers and agencies that need invoicing, credit terms, white-glove setup, and dedicated customer support.",
        features: [
            "Invoicing and credit terms (30–60 days)",
            "White-glove onboarding and setup",
            "Dedicated support",
            "SLA",
        ],
        trust: null,
        cta: "Contact Us",
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
                        subtitle="Two products. Both free forever for 30-day rolling data."
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
