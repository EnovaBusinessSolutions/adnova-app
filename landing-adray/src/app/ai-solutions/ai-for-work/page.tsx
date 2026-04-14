"use client";

import React from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import Container from "@/components/ui/Container";
import SectionHeading from "@/components/ui/SectionHeading";
import AnimatedSection from "@/components/ui/AnimatedSection";
import Button from "@/components/ui/Button";

const features = [
    {
        title: "Smart Scheduling",
        description:
            "AI-driven calendar management that resolves conflicts, prioritizes meetings, and optimizes your team's time across time zones.",
    },
    {
        title: "Task Automation",
        description:
            "Automate repetitive tasks like follow-ups, approvals, and data entry — freeing your team to focus on high-impact work.",
    },
    {
        title: "Knowledge Search",
        description:
            "Instantly find relevant documents, past decisions, and internal knowledge using natural language queries across all connected systems.",
    },
    {
        title: "Meeting Insights",
        description:
            "Get AI-generated summaries, action items, and sentiment analysis from every meeting — automatically synced to your workflow tools.",
    },
];

const benefits = [
    "40% reduction in manual task handling",
    "Cross-department workflow automation",
    "Seamless integration with 200+ tools",
    "Real-time team productivity dashboards",
    "Enterprise-grade security and compliance",
];

const ease = [0.21, 0.47, 0.32, 0.98] as const;

export default function AIForWorkPage() {
    return (
        <>
            {/* ── Hero ── */}
            <section className="relative pt-40 pb-20 overflow-hidden">
                <div
                    className="absolute inset-0 opacity-30"
                    style={{
                        backgroundImage:
                            "url(https://framerusercontent.com/images/XXSw2JqvtikgOcaexTTozzVsO54.webp)",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        maskImage:
                            "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
                        WebkitMaskImage:
                            "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
                        filter: "sepia(1) hue-rotate(230deg) saturate(2)",
                    }}
                />
                <Container className="relative z-10 text-center">
                    <motion.p
                        className="t-p-sm uppercase tracking-widest text-ad-tag mb-4"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, ease }}
                    >
                        AI FOR WORK
                    </motion.p>
                    <motion.h1
                        className="t-h1 text-white-90 mb-6"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.1, ease }}
                    >
                        Productivity at Scale
                    </motion.h1>
                    <motion.p
                        className="t-p-lg text-ad-subtitle max-w-2xl mx-auto mb-10"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.25, ease }}
                    >
                        Empower your workforce with intelligent automation that adapts,
                        learns, and accelerates execution across every department.
                    </motion.p>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.7, delay: 0.4, ease }}
                    >
                        <Button variant="primary" size="lg" href="/getstarted">
                            Get Started
                        </Button>
                    </motion.div>
                </Container>
            </section>

            {/* ── Features ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <SectionHeading
                            tag="FEATURES"
                            tagIcon={
                                <img
                                    src="https://framerusercontent.com/images/oy9JJgqQoJmcnZPSNiNcPKB5Ig.svg"
                                    alt=""
                                    width={24}
                                    height={24}
                                />
                            }
                            title="Built for Modern Teams"
                            subtitle="Every feature is designed to eliminate friction and amplify productivity across your organization."
                        />
                    </AnimatedSection>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {features.map((f, i) => (
                            <AnimatedSection key={f.title} delay={i * 0.1}>
                                <div className="card p-8 h-full">
                                    <h3 className="t-h4 text-white-90 mb-3">{f.title}</h3>
                                    <p className="t-p-sm text-ad-muted leading-relaxed">
                                        {f.description}
                                    </p>
                                </div>
                            </AnimatedSection>
                        ))}
                    </div>
                </Container>
            </section>

            {/* ── Benefits ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <div className="card p-10 md:p-16 max-w-2xl mx-auto">
                            <h2 className="t-h2 text-white-90 mb-8 text-center">
                                Why AI for Work?
                            </h2>
                            <ul className="space-y-4">
                                {benefits.map((b) => (
                                    <li
                                        key={b}
                                        className="flex items-start gap-3 t-p text-white-90"
                                    >
                                        <Check
                                            size={18}
                                            className="text-ad-primary shrink-0 mt-0.5"
                                        />
                                        {b}
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-10 text-center">
                                <Button variant="primary" href="/contact">
                                    Talk to Sales
                                </Button>
                            </div>
                        </div>
                    </AnimatedSection>
                </Container>
            </section>
        </>
    );
}
