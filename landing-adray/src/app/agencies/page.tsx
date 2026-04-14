"use client";

import React from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import Container from "@/components/ui/Container";
import AnimatedSection from "@/components/ui/AnimatedSection";
import Button from "@/components/ui/Button";
import { brandify } from "@/lib/utils";

const howItWorks = [
    {
        title: "One login, multiple client workspaces",
        description:
            "Every client lives in their own isolated workspace. Switch in seconds, no separate logins.",
    },
    {
        title: "Separate data link per client",
        description:
            "Each client gets their own secure, portable link. Drop it in any AI and get that client\u2019s full context instantly.",
    },
    {
        title: "Aggregated cross-client reporting",
        description:
            "See performance across your entire book of business in one view. Spot trends, compare clients, identify who needs attention.",
    },
    {
        title: "Refreshes automatically",
        description:
            "Every client\u2019s data link updates daily. No manual pulls, no stale reports.",
    },
];

const pricingPoints = [
    "Your first workspace is included in Pro. Each additional client workspace is $25/mo + 0.3% of that client\u2019s ad spend.",
    "Ad spend fee capped at $1,250/month per workspace.",
    "No per-seat fees. No platform minimums. Scales with your client roster.",
];

const ease = [0.21, 0.47, 0.32, 0.98] as const;

export default function AgenciesPage() {
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
                        FOR AGENCIES
                    </motion.p>
                    <motion.h1
                        className="t-h1 text-white-100 mb-6"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.1, ease }}
                    >
                        One login. Every client. Any AI.
                    </motion.h1>
                    <motion.p
                        className="t-p-lg text-ad-subtitle max-w-2xl mx-auto mb-10"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.25, ease }}
                    >
                        Stop switching between accounts, exporting reports, and rebuilding
                        context every time a client asks a question. <span style={{ fontFamily: 'var(--font-brand)' }}>Adray</span> gives your agency
                        one place to manage every client&apos;s marketing data &mdash; with a
                        separate, secure data link for each one.
                    </motion.p>
                    <motion.div
                        className="flex flex-col sm:flex-row items-center justify-center gap-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.7, delay: 0.4, ease }}
                    >
                        <Button variant="primary" size="lg" href="/getstarted">
                            Get Started Free
                        </Button>
                        <Button variant="ghost" size="lg" href="/contact">
                            Talk to Our Team
                        </Button>
                    </motion.div>
                </Container>
            </section>

            {/* ── How It Works ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <h2 className="t-h2 text-white-100 text-center mb-4">
                            How it works for agencies
                        </h2>
                    </AnimatedSection>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
                        {howItWorks.map((item, i) => (
                            <AnimatedSection key={item.title} delay={i * 0.1}>
                                <div className="card p-8 h-full">
                                    <h3 className="t-h4 text-white-90 mb-3">
                                        {item.title}
                                    </h3>
                                    <p className="t-p-sm text-ad-muted leading-relaxed">
                                        {item.description}
                                    </p>
                                </div>
                            </AnimatedSection>
                        ))}
                    </div>
                </Container>
            </section>

            {/* ── Agency Workflow ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <div className="card p-10 md:p-16 max-w-3xl mx-auto text-center">
                            <h2 className="t-h2 text-white-100 mb-6">
                                The agency workflow, reimagined
                            </h2>
                            <p className="t-p text-ad-muted leading-relaxed max-w-2xl mx-auto">
                                Connect a new client in under 2 minutes. Authorize their Meta,
                                Google, GA4, and Shopify. Their data link is ready. Drop it in
                                Claude, ChatGPT, or any AI &mdash; and walk into every client
                                call with full context, zero prep.
                            </p>
                        </div>
                    </AnimatedSection>
                </Container>
            </section>

            {/* ── Pricing ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <div className="card p-10 md:p-16 max-w-2xl mx-auto">
                            <h2 className="t-h2 text-white-100 mb-8 text-center">
                                Pricing for agencies
                            </h2>
                            <ul className="space-y-4">
                                {pricingPoints.map((point) => (
                                    <li
                                        key={point}
                                        className="flex items-start gap-3 t-p text-white-90"
                                    >
                                        <Check
                                            size={18}
                                            className="text-ad-primary shrink-0 mt-0.5"
                                        />
                                        {point}
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                                <Button variant="primary" href="/getstarted">
                                    Get Started Free
                                </Button>
                                <Button variant="ghost" href="/contact">
                                    Talk to Our Team
                                </Button>
                            </div>
                        </div>
                    </AnimatedSection>
                </Container>
            </section>

            {/* ── Built For Agencies ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <div className="max-w-3xl mx-auto text-center">
                            <h2 className="t-h2 text-white-100 mb-6">
                                Built for how agencies actually work
                            </h2>
                            <p className="t-p text-ad-muted leading-relaxed mb-4">
                                Most tools make you log in as each client, manage separate
                                dashboards, and manually compile reporting. <span style={{ fontFamily: 'var(--font-brand)' }}>Adray</span> flips that
                                &mdash; your AI does the analysis, you do the strategy.
                            </p>
                            <p className="t-p text-ad-subtitle leading-relaxed">
                                This is what it looks like when your entire client portfolio
                                fits in a chat window.
                            </p>
                        </div>
                    </AnimatedSection>
                </Container>
            </section>

            {/* ── Bottom CTA ── */}
            <section className="py-20 relative">
                <Container className="text-center">
                    <AnimatedSection>
                        <h2 className="t-h2 text-white-100 mb-4">
                            Your AI is ready. Give it something real to work with.
                        </h2>
                        <p className="t-p-lg text-ad-muted max-w-xl mx-auto mb-10">
                            Install free. Connect in 2 minutes. Ask your first real question.
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                            <Button variant="primary" size="lg" href="/getstarted">
                                Get Started Free
                            </Button>
                            <Button variant="ghost" size="lg" href="/contact">
                                Talk to Our Team
                            </Button>
                        </div>
                        <p className="mt-4 t-p-sm text-ad-muted">
                            Free forever &middot; No credit card &middot; Works on any website
                        </p>
                    </AnimatedSection>
                </Container>
            </section>
        </>
    );
}
