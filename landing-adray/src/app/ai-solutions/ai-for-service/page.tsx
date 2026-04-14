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
        title: "Smart Routing",
        description:
            "Automatically direct customer inquiries to the right agent or AI responder based on topic, urgency, and customer history.",
    },
    {
        title: "Sentiment Analysis",
        description:
            "Understand customer emotions in real time. AI flags frustration early so your team can intervene before issues escalate.",
    },
    {
        title: "Real-Time Resolve",
        description:
            "AI agents resolve common issues instantly — refunds, password resets, billing questions — without human intervention.",
    },
    {
        title: "Omnichannel",
        description:
            "Deliver consistent, intelligent support across email, chat, phone, social, and messaging platforms from a single AI brain.",
    },
];

const benefits = [
    "60% faster first-response times",
    "24/7 intelligent customer support",
    "Seamless human-AI agent handoff",
    "Multi-language support out of the box",
    "Complete conversation history & analytics",
];

const ease = [0.21, 0.47, 0.32, 0.98] as const;

export default function AIForServicePage() {
    return (
        <>
            {/* ── Hero ── */}
            <section className="relative pt-40 pb-20 overflow-hidden">
                <div
                    className="absolute inset-0 opacity-30"
                    style={{
                        backgroundImage:
                            "url(https://framerusercontent.com/images/4fEwCxLuKCW6ZaczMzoeCElmzBg.webp)",
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
                        AI FOR SERVICE
                    </motion.p>
                    <motion.h1
                        className="t-h1 text-white-90 mb-6"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.1, ease }}
                    >
                        Redefine the CX
                    </motion.h1>
                    <motion.p
                        className="t-p-lg text-ad-subtitle max-w-2xl mx-auto mb-10"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.25, ease }}
                    >
                        Deliver instant, intelligent, and empathetic customer experiences
                        with AI agents that understand context and resolve issues 24/7.
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
                                    src="https://framerusercontent.com/images/hkm6Dj8bW8kfsHv25c6tUxDVgU.svg"
                                    alt=""
                                    width={24}
                                    height={24}
                                />
                            }
                            title="Customer Service, Reimagined"
                            subtitle="AI agents that go beyond scripted responses to deliver truly helpful, contextual customer support."
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
                                Why AI for Service?
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
