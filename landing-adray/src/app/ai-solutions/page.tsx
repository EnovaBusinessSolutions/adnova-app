"use client";

import React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import Container from "@/components/ui/Container";
import AnimatedSection from "@/components/ui/AnimatedSection";
import BlurRevealText from "@/components/ui/BlurRevealText";
import { pub } from "@/lib/paths";

const solutions = [
    {
        title: "AI for Work",
        description: "Search silos, automate workflows, and govern confidently.",
        headline: "Productivity at scale",
        features: ["Enterprise Search", "AI Agent Builder", "Intelligent Orchestrator", "Admin Controls"],
        href: "/ai-solutions/ai-for-work",
        gradient: "https://framerusercontent.com/images/ixSlHBj93cQxMvRKBPxUGuiwRE.png",
    },
    {
        title: "AI for Service",
        description: "Leverage AI agents to empower customers and personalize.",
        headline: "Redefine the CX",
        features: ["Agentic Contact Center", "Agent AI Assistance", "Quality Assurance", "Outbound Campaigns"],
        href: "/ai-solutions/ai-for-service",
        gradient: "https://framerusercontent.com/images/pSxYz80kLUKNMKdnW99z0alJYJ0.png",
    },
    {
        title: "AI for Process",
        description: "Simplify complex business processes with autonomous AI agents.",
        headline: "Process Intelligence",
        features: ["Process automation", "AI analytics + monitoring", "Pre-built process templates", "Seamless System Integration"],
        href: "/ai-solutions/ai-for-process",
        gradient: "https://framerusercontent.com/images/yxLTC9cANtOH1hhf7cA7mlRT8.png",
    },
];

const ease = [0.21, 0.47, 0.32, 0.98] as const;

export default function AISolutionsPage() {
    return (
        <>
            {/* ── Hero ── */}
            <section className="relative pt-40 pb-20 overflow-hidden">
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        backgroundImage:
                            "url(https://framerusercontent.com/images/H3Q7Up1GD9JyEYygvN5U7fWpqYQ.webp)",
                        backgroundSize: "cover",
                        backgroundPosition: "center top",
                        opacity: 0.5,
                        filter: "sepia(1) hue-rotate(230deg) saturate(2)",
                    }}
                />
                <Container className="relative z-10 text-center">
                    <motion.div
                        className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white-7 text-white-90 t-p-sm mb-6"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.6, ease }}
                    >
                        <img
                            src={pub("/images/svg/kSe62iNOdnrgkLKL07t29GUEak.svg")}
                            alt=""
                            width={24}
                            height={24}
                        />
                        SOLUTIONS
                    </motion.div>
                    <motion.h1
                        className="t-h1 text-white-90 mb-6"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.1, ease }}
                    >
                        <BlurRevealText text="Discover the Power of Adray" startDelay={0.15} />
                    </motion.h1>
                    <motion.p
                        className="t-p-lg text-ad-subtitle max-w-2xl mx-auto"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.25, ease }}
                    >
                        Explore our suite of AI-driven solutions designed to redefine work.
                    </motion.p>
                </Container>
            </section>

            {/* ── Solution Cards ── */}
            <section className="py-20 relative">
                <Container>
                    <div className="flex flex-col gap-8">
                        {solutions.map((s, i) => (
                            <AnimatedSection key={s.title} delay={i * 0.12}>
                                <div className="card overflow-hidden rounded-3xl">
                                    <div className="p-8 md:p-12">
                                        {/* Title + description */}
                                        <h3 className="t-h4 text-white-90 mb-2">
                                            {s.title}
                                        </h3>
                                        <p className="t-p text-ad-muted leading-relaxed max-w-md mb-5">
                                            {s.description}
                                        </p>

                                        {/* CTA button */}
                                        <Link
                                            href={s.href}
                                            className="inline-flex items-center px-5 py-2.5 rounded-[15px] bg-ad-dark border border-ad-border t-p-sm font-semibold text-gradient hover:brightness-125 transition-all mb-8"
                                        >
                                            Learn More
                                        </Link>

                                        {/* Divider */}
                                        <div className="h-px w-full bg-ad-border mb-8" />

                                        {/* Features heading + vertical dot list */}
                                        <p className="t-p-sm text-ad-tag uppercase tracking-widest mb-4">
                                            {s.headline}
                                        </p>
                                        <ul className="space-y-3 mb-8">
                                            {s.features.map((f) => (
                                                <li key={f} className="flex items-center gap-3">
                                                    <span
                                                        className="w-2 h-2 rounded-full shrink-0"
                                                        style={{ background: "linear-gradient(148deg, var(--ad-accent), var(--ad-primary))" }}
                                                    />
                                                    <span className="t-p text-ad-subtitle">{f}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    {/* Bottom gradient image strip */}
                                    <img
                                        src={s.gradient}
                                        alt=""
                                        className="w-full h-auto"
                                    />
                                </div>
                            </AnimatedSection>
                        ))}
                    </div>
                </Container>
            </section>
        </>
    );
}
