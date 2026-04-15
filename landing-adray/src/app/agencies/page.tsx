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
        title: "One account. Unlimited clients.",
        description:
            "Manage every client from a single Adray account. Each client lives in their own isolated workspace \u2014 switch in seconds, no separate logins.",
    },
    {
        title: "Unlimited seats per workspace",
        description:
            "Add your full team to each client workspace at no extra cost. No per-seat fees, ever.",
    },
    {
        title: "Separate payment details per workspace",
        description:
            "Bill clients directly or manage billing by workspace. Each workspace can have its own payment method.",
    },
    {
        title: "A dedicated Signal per client",
        description:
            "Each client gets their own daily Signal PDF delivered to your inbox, plus a dedicated ChatGPT Custom GPT and Claude MCP connector. Drop the PDF in any AI or connect via MCP \u2014 walk into every client call with full context, zero prep.",
    },
    {
        title: "Refreshes automatically",
        description:
            "Every client\u2019s data updates daily. No manual pulls, no stale reports.",
    },
];

const agencyTiers = [
    {
        name: "Signal workspaces",
        free: "Free for 30-day rolling data.",
        paid: "$49/month per workspace for unlimited history and live chat support.",
        extra: "Additional workspaces: $29/month each.",
    },
    {
        name: "Core workspaces",
        free: "Free for 30-day rolling data.",
        paid: "$99/month + 1% of that client\u2019s monthly ad spend (capped at $1,500/month) for unlimited history and live chat support.",
        extra: "Additional workspaces: $49/month + 1% of ad spend each.",
    },
];

const pricingNotes = [
    "No per-seat fees. No platform minimums. Scales with your client roster.",
    "Need more than 10 workspaces? Contact us for volume pricing and custom setup.",
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
                        Built by agency marketers. For agency marketers.
                    </motion.h1>
                    <motion.p
                        className="t-p-lg text-ad-subtitle max-w-2xl mx-auto mb-10"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.25, ease }}
                    >
                        <span style={{ fontFamily: 'var(--font-brand)' }}>Adray</span> is built by agency marketers for agencies and digital marketing
                        consulting firms. We work with forward-thinking teams who prioritize
                        data quality in their client work and implement cutting-edge
                        technologies in their workflows. We want to help you move faster
                        and grow efficiently.
                    </motion.p>
                    <motion.div
                        className="flex flex-col sm:flex-row items-center justify-center gap-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.7, delay: 0.4, ease }}
                    >
                        <Button variant="primary" size="lg" href="/login">
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
                            <AnimatedSection
                                key={item.title}
                                delay={i * 0.1}
                                className={
                                    i === howItWorks.length - 1
                                        ? "md:col-span-2 md:max-w-xl md:mx-auto"
                                        : undefined
                                }
                            >
                                <div className="card p-8 h-full">
                                    <h3 className="t-h4 text-white-90 mb-3">
                                        {item.title}
                                    </h3>
                                    <p className="t-p-sm text-ad-muted leading-relaxed">
                                        {brandify(item.description)}
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
                                Google Ads, and GA4. Their daily Signal PDF is ready and in
                                your inbox. Drop it in any AI, or connect via Claude MCP or
                                ChatGPT Custom GPT &mdash; and start doing real analysis, not
                                data wrangling.
                            </p>
                            <p className="t-p text-ad-subtitle leading-relaxed mt-4 max-w-2xl mx-auto">
                                This is what it looks like when your entire client portfolio
                                fits in a chat window.
                            </p>
                        </div>
                    </AnimatedSection>
                </Container>
            </section>

            {/* ── Pricing ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <h2 className="t-h2 text-white-100 mb-10 text-center">
                            Pricing for agencies
                        </h2>
                    </AnimatedSection>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
                        {agencyTiers.map((tier, i) => (
                            <AnimatedSection key={tier.name} delay={i * 0.1}>
                                <div className="card p-8 h-full flex flex-col">
                                    <h3 className="t-h4 text-white-90 mb-4">
                                        {tier.name}
                                    </h3>
                                    <p className="t-p-sm text-ad-muted leading-relaxed mb-2">
                                        {tier.free}
                                    </p>
                                    <p className="t-p-sm text-white-90 leading-relaxed mb-2">
                                        {tier.paid}
                                    </p>
                                    <p className="t-p-sm text-ad-muted leading-relaxed mt-auto pt-2">
                                        {tier.extra}
                                    </p>
                                </div>
                            </AnimatedSection>
                        ))}
                    </div>

                    <AnimatedSection delay={0.2}>
                        <div className="max-w-3xl mx-auto mt-8">
                            <ul className="space-y-3">
                                {pricingNotes.map((note) => (
                                    <li
                                        key={note}
                                        className="flex items-start gap-3 t-p-sm text-ad-muted justify-center"
                                    >
                                        <Check
                                            size={16}
                                            className="text-ad-primary shrink-0 mt-0.5"
                                        />
                                        {note}
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                                <Button variant="primary" href="/login">
                                    Get Started Free
                                </Button>
                                <Button variant="ghost" href="/contact">
                                    Contact Us for Volume Pricing
                                </Button>
                            </div>
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
                            Install free. Connect your first client in 2 minutes. Start doing better work.
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                            <Button variant="primary" size="lg" href="/login">
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
