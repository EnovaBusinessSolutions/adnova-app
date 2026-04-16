"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Check, Plus, Minus } from "lucide-react";
import Container from "@/components/ui/Container";
import SectionHeading from "@/components/ui/SectionHeading";
import AnimatedSection from "@/components/ui/AnimatedSection";
import Button from "@/components/ui/Button";
import { pub } from "@/lib/paths";

/* ── Comparison Table ── */
type CellValue = boolean | string;

const comparisonRows: Array<{
    feature: string;
    sigFree: CellValue;
    sigPaid: CellValue;
    coreFree: CellValue;
    corePaid: CellValue;
    enterprise: CellValue;
}> = [
    { feature: "Meta Ads, Google Ads & GA4", sigFree: true, sigPaid: true, coreFree: true, corePaid: true, enterprise: true },
    { feature: "Daily Signal PDF", sigFree: true, sigPaid: true, coreFree: true, corePaid: true, enterprise: true },
    { feature: "Custom GPT for ChatGPT", sigFree: true, sigPaid: true, coreFree: true, corePaid: true, enterprise: true },
    { feature: "MCP connector for Claude", sigFree: true, sigPaid: true, coreFree: true, corePaid: true, enterprise: true },
    { feature: "Looker Studio (coming soon)", sigFree: true, sigPaid: true, coreFree: true, corePaid: true, enterprise: true },
    { feature: "30-day rolling data", sigFree: true, sigPaid: true, coreFree: true, corePaid: true, enterprise: true },
    { feature: "Unlimited historical data", sigFree: false, sigPaid: true, coreFree: false, corePaid: true, enterprise: true },
    { feature: "Dedicated live chat support", sigFree: false, sigPaid: true, coreFree: false, corePaid: true, enterprise: true },
    { feature: "Adray pixel + CAPI enrichment", sigFree: false, sigPaid: false, coreFree: true, corePaid: true, enterprise: true },
    { feature: "Behavioral Revenue Intelligence", sigFree: false, sigPaid: false, coreFree: true, corePaid: true, enterprise: true },
    { feature: "Attribution Deviation Modeling", sigFree: false, sigPaid: false, coreFree: true, corePaid: true, enterprise: true },
    { feature: "Server-side website data", sigFree: false, sigPaid: false, coreFree: true, corePaid: true, enterprise: true },
    { feature: "Invoicing & credit terms", sigFree: false, sigPaid: false, coreFree: false, corePaid: false, enterprise: true },
    { feature: "White-glove onboarding", sigFree: false, sigPaid: false, coreFree: false, corePaid: false, enterprise: true },
    { feature: "Dedicated CSM", sigFree: false, sigPaid: false, coreFree: false, corePaid: false, enterprise: true },
    { feature: "SLA", sigFree: false, sigPaid: false, coreFree: false, corePaid: false, enterprise: true },
    { feature: "Additional workspaces", sigFree: false, sigPaid: "$29/mo each", coreFree: false, corePaid: "$49/mo + 1% each", enterprise: "Custom" },
];

/* ── FAQ ── */
const faqs = [
    {
        q: "What is Adray Signal?",
        a: "Signal connects your marketing stack — Meta Ads, Google Ads, Google Analytics, and more — and delivers your data as a daily Signal PDF, a Custom GPT for ChatGPT, a live MCP connector for Claude, and a Looker Studio connector. 30-day rolling data is free forever. Unlimited history is $49/month.",
    },
    {
        q: "What is Adray Core?",
        a: "Core builds on Signal and adds the Adray pixel, CAPI enrichment, Behavioral Revenue Intelligence, Attribution Deviation Modeling, and server-side website data. It includes everything in Signal. 30-day rolling data is free forever. Unlimited history is $99/month plus 1% of your monthly ad spend, capped at $1,500/month.",
    },
    {
        q: "Do I need Core or is Signal enough?",
        a: "If you're running paid media and want clean, AI-ready data from your platforms, Signal is enough. If you're a performance marketer or ecommerce brand that needs full attribution depth — pixel, server-side events, and revenue intelligence — you need Core.",
    },
    {
        q: "What does the free tier include?",
        a: "Both Signal and Core are free forever for 30-day rolling data. No credit card required. Includes AI and email support.",
    },
    {
        q: "What does paid unlock?",
        a: "Unlimited historical data access and dedicated live chat support. That's it.",
    },
    {
        q: "How does the 1% ad spend fee work?",
        a: "The ad spend fee only applies to Core — it's tied to the pixel. Signal has no ad spend fee. The fee is capped at $1,500/month per workspace.",
    },
    {
        q: "What is the Enterprise plan?",
        a: "A sales-assisted plan for advertisers and agencies who need invoicing, credit terms, white-glove setup, and a dedicated support contact. Available on Signal or Core. Contact us to get a proposal.",
    },
    {
        q: "How fast is setup?",
        a: "Account creation takes under 30 seconds. OAuth connections take under 2 minutes. Your first Signal PDF is ready in minutes.",
    },
    {
        q: "What platforms does Signal connect to?",
        a: "Currently: Meta Ads, Google Ads, and Google Analytics. Coming soon: TikTok, LinkedIn, HubSpot, Salesforce, Zoho, Google Merchant Center, and more.",
    },
];

const ease = [0.21, 0.47, 0.32, 0.98] as const;

function Cell({ value }: { value: CellValue }) {
    if (value === true)
        return <Check size={16} className="text-ad-primary mx-auto" />;
    if (value === false)
        return <span className="text-ad-muted/40 block text-center select-none">—</span>;
    return <span className="t-p-sm text-white-90 block text-center">{value}</span>;
}

function AccordionItem({ q, a }: { q: string; a: string }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="rounded-[24px] border border-ad-border bg-ad-dark overflow-hidden transition-all duration-300">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between p-6 text-left cursor-pointer"
            >
                <span className="t-p font-medium text-white-90 pr-4">{q}</span>
                <span className="w-8 h-8 rounded-full bg-white-7 border border-ad-border flex items-center justify-center shrink-0">
                    {open ? <Minus size={14} className="text-white-90" /> : <Plus size={14} className="text-white-90" />}
                </span>
            </button>
            <div className={`overflow-hidden transition-all duration-300 ${open ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"}`}>
                <p className="px-6 pb-6 t-p-sm text-ad-muted leading-relaxed">{a}</p>
            </div>
        </div>
    );
}

export default function PricingPage() {
    return (
        <>
            {/* ── Hero ── */}
            <section className="relative pt-40 pb-10 overflow-hidden">
                <img
                    src="https://framerusercontent.com/images/H3Q7Up1GD9JyEYygvN5U7fWpqYQ.webp"
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    style={{ filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                />
                <Container className="relative z-10 text-center">
                    <motion.div
                        className="flex items-center gap-3 justify-center mb-4"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, ease }}
                    >
                        <img src={pub("/images/svg/3UovOTKirX07vhyWYJGSliEt1E4.svg")} alt="" width={24} height={24} className="opacity-80" />
                        <span className="t-p-sm uppercase tracking-widest text-white-90">PRICING</span>
                    </motion.div>
                    <motion.h1
                        className="t-h1 text-white-100 mb-6"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.1, ease }}
                    >
                        Two products. Both free to start.
                    </motion.h1>
                    <motion.p
                        className="t-p-lg text-ad-subtitle max-w-2xl mx-auto"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.25, ease }}
                    >
                        30-day rolling data, free forever. Pay only when you need unlimited history and dedicated support.
                    </motion.p>
                </Container>
            </section>

            {/* ── Signal ── */}
            <section className="py-12 relative">
                <Container>
                    <AnimatedSection>
                        <div className="mb-8">
                            <span className="t-p-sm uppercase tracking-widest text-ad-tag font-medium">Adray Signal</span>
                            <h2 className="t-h2 text-white-100 mt-2 mb-2">Your entire marketing stack in your LLM and Looker Studio.</h2>
                            <p className="t-p text-ad-muted max-w-2xl">Any marketer, any industry. No pixel required.</p>
                        </div>
                    </AnimatedSection>

                    <AnimatedSection delay={0.1}>
                        <div className="card p-8 mb-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                <div>
                                    <p className="t-p-sm font-semibold text-white-90 mb-3">How you get your data</p>
                                    <ul className="space-y-2">
                                        {[
                                            "Daily Signal PDF delivered to your inbox — works in any AI",
                                            "Custom GPT for ChatGPT",
                                            "MCP connector for Claude (live now)",
                                            "Looker Studio connector (coming soon)",
                                        ].map((f) => (
                                            <li key={f} className="flex items-start gap-3">
                                                <Check size={15} className="text-ad-primary shrink-0 mt-0.5" />
                                                <span className="t-p-sm text-white-90">{f}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <div>
                                    <p className="t-p-sm font-semibold text-white-90 mb-3">Platforms included now</p>
                                    <p className="t-p-sm text-white-90 mb-4">Meta Ads · Google Ads · Google Analytics</p>
                                    <p className="t-p-sm font-semibold text-white-90 mb-2">Coming soon</p>
                                    <p className="t-p-sm text-ad-muted">TikTok · LinkedIn · HubSpot · Salesforce · Zoho · Google Merchant Center · and more</p>
                                </div>
                            </div>
                        </div>
                    </AnimatedSection>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Signal Free */}
                        <AnimatedSection delay={0.15}>
                            <div className="card relative overflow-hidden h-full flex flex-col">
                                <img
                                    src="https://framerusercontent.com/images/XXSw2JqvtikgOcaexTTozzVsO54.webp"
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                                    style={{ filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                                />
                                <div className="relative z-10 p-8 flex flex-col h-full">
                                    <h3 className="t-h4 text-white-90">Signal Free</h3>
                                    <div className="mt-3 flex items-baseline gap-1">
                                        <span className="text-4xl font-bold text-white-90">$0</span>
                                        <span className="text-ad-muted t-p-sm">/month</span>
                                    </div>
                                    <p className="mt-2 t-p-sm text-ad-muted">Free forever — 30-day rolling data · No credit card needed · AI and email support</p>
                                    <div className="mt-auto pt-6 mb-[7px]">
                                        <Button variant="primary" href="/login" className="w-full whitespace-nowrap min-h-[48px]">
                                            Get Started Free
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </AnimatedSection>

                        {/* Signal Paid */}
                        <AnimatedSection delay={0.22}>
                            <div className="card relative overflow-hidden h-full flex flex-col">
                                <img
                                    src="https://framerusercontent.com/images/4fEwCxLuKCW6ZaczMzoeCElmzBg.webp"
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                                    style={{ filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                                />
                                <div className="relative z-10 p-8 flex flex-col h-full">
                                    <h3 className="t-h4 text-white-90">Signal</h3>
                                    <div className="mt-3 flex items-baseline gap-1">
                                        <span className="text-4xl font-bold text-white-90">$49</span>
                                        <span className="text-ad-muted t-p-sm">/month</span>
                                    </div>
                                    <div className="mt-4 space-y-2">
                                        {[
                                            "Unlimited historical data",
                                            "Dedicated live chat support",
                                            "Additional workspaces: $29/month each",
                                        ].map((f) => (
                                            <div key={f} className="flex items-start gap-3">
                                                <Check size={15} className="text-ad-primary shrink-0 mt-0.5" />
                                                <span className="t-p-sm text-white-90">{f}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-auto pt-6 mb-2">
                                        <Button variant="primary" href="/login" className="w-full whitespace-nowrap min-h-[48px]">
                                            Start Signal
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </AnimatedSection>
                    </div>
                </Container>
            </section>

            {/* ── Core ── */}
            <section className="py-12 relative">
                <Container>
                    <AnimatedSection>
                        <div className="mb-8">
                            <span className="t-p-sm uppercase tracking-widest text-ad-tag font-medium">Adray Core</span>
                            <h2 className="t-h2 text-white-100 mt-2 mb-2">Full attribution depth. Server-side intelligence. Built for performance.</h2>
                            <p className="t-p text-ad-muted max-w-2xl">Performance marketers and ecommerce brands. Core always includes Signal.</p>
                        </div>
                    </AnimatedSection>

                    <AnimatedSection delay={0.1}>
                        <div className="card p-8 mb-6">
                            <p className="t-p-sm font-semibold text-white-90 mb-4">Includes everything in Signal, plus:</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {[
                                    "Adray pixel + CAPI enrichment",
                                    "Behavioral Revenue Intelligence (BRI) — individual customer journey reasoning at scale",
                                    "Attribution Deviation Modeling",
                                    "Server-side website data",
                                ].map((f) => (
                                    <div key={f} className="flex items-start gap-3">
                                        <Check size={15} className="text-ad-primary shrink-0 mt-0.5" />
                                        <span className="t-p-sm text-white-90">{f}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="t-p-sm text-ad-muted mt-4">No pixel = no spend fee.</p>
                        </div>
                    </AnimatedSection>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Core Free */}
                        <AnimatedSection delay={0.15}>
                            <div className="card relative overflow-hidden h-full flex flex-col">
                                <img
                                    src="https://framerusercontent.com/images/XXSw2JqvtikgOcaexTTozzVsO54.webp"
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                                    style={{ filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                                />
                                <div className="relative z-10 p-8 flex flex-col h-full">
                                    <h3 className="t-h4 text-white-90">Core Free</h3>
                                    <div className="mt-3 flex items-baseline gap-1">
                                        <span className="text-4xl font-bold text-white-90">$0</span>
                                        <span className="text-ad-muted t-p-sm">/month</span>
                                    </div>
                                    <p className="mt-2 t-p-sm text-ad-muted">Free forever — 30-day rolling data · No credit card needed · AI and email support</p>
                                    <div className="mt-auto pt-6 mb-2">
                                        <Button variant="primary" href="/login" className="w-full whitespace-nowrap min-h-[48px]">
                                            Get Started Free
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </AnimatedSection>

                        {/* Core Paid */}
                        <AnimatedSection delay={0.22}>
                            <div className="card relative overflow-hidden h-full flex flex-col">
                                <img
                                    src="https://framerusercontent.com/images/4fEwCxLuKCW6ZaczMzoeCElmzBg.webp"
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                                    style={{ filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                                />
                                <div className="relative z-10 p-8 flex flex-col h-full">
                                    <h3 className="t-h4 text-white-90">Core</h3>
                                    <div className="mt-3">
                                        <span className="text-4xl font-bold text-white-90">$99</span>
                                        <span className="text-ad-muted t-p-sm">/month</span>
                                        <span className="t-p-sm text-ad-muted ml-1">+ 1% of ad spend (cap $1,500/mo)</span>
                                    </div>
                                    <div className="mt-4 space-y-2">
                                        {[
                                            "Unlimited historical data",
                                            "Dedicated live chat support",
                                            "Additional workspaces: $49/month + 1% each",
                                        ].map((f) => (
                                            <div key={f} className="flex items-start gap-3">
                                                <Check size={15} className="text-ad-primary shrink-0 mt-0.5" />
                                                <span className="t-p-sm text-white-90">{f}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-6 mb-2">
                                        <Button variant="primary" href="/login" className="w-full whitespace-nowrap min-h-[48px]">
                                            Start Core
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </AnimatedSection>
                    </div>
                </Container>
            </section>

            {/* ── Enterprise ── */}
            <section className="py-12 relative">
                <Container>
                    <AnimatedSection>
                        <div className="card relative overflow-hidden">
                            <img
                                src="https://framerusercontent.com/images/K53jEm1inmwk6lcSyDVU5W7rvLM.webp"
                                alt=""
                                className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-events-none"
                                style={{ filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                            />
                            <div className="relative z-10 p-8 md:p-12">
                                <div className="flex items-center gap-3 mb-4">
                                    <span className="t-p-sm uppercase tracking-widest text-ad-tag font-medium">Enterprise</span>
                                </div>
                                <h2 className="t-h3 text-white-100 mb-3">For advertisers and agencies that need invoicing, credit terms, white-glove setup, and dedicated customer support.</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 mb-8">
                                    <div className="rounded-xl border border-ad-border p-5">
                                        <p className="t-p-sm text-ad-muted mb-1">Signal Enterprise</p>
                                        <p className="t-h3 text-white-100">$499<span className="t-p-sm text-ad-muted font-normal">/month</span></p>
                                    </div>
                                    <div className="rounded-xl border border-ad-border p-5">
                                        <p className="t-p-sm text-ad-muted mb-1">Core Enterprise</p>
                                        <p className="t-h3 text-white-100">1% <span className="t-p-sm text-ad-muted font-normal">of ad spend, min $1,500/month</span></p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
                                    {[
                                        "Invoicing and credit terms (30–60 days)",
                                        "White-glove onboarding and setup",
                                        "Dedicated support",
                                        "SLA",
                                    ].map((f) => (
                                        <div key={f} className="flex items-start gap-3">
                                            <Check size={15} className="text-ad-primary shrink-0 mt-0.5" />
                                            <span className="t-p-sm text-white-90">{f}</span>
                                        </div>
                                    ))}
                                </div>
                                <Button variant="primary" href="/contact">
                                    Talk to Our Team
                                </Button>
                            </div>
                        </div>
                    </AnimatedSection>
                </Container>
            </section>

            {/* ── Comparison Table ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <SectionHeading
                            tag="COMPARISON"
                            tagIcon={<img src={pub("/images/svg/X5M3y8eb51ZE3hAx5kOkcLqc83U.svg")} alt="" width={24} height={24} />}
                            title="Compare plans"
                            subtitle="Everything included across Signal, Core, and Enterprise."
                        />
                    </AnimatedSection>

                    <AnimatedSection delay={0.15}>
                        <div className="card overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left min-w-[700px]">
                                    <thead>
                                        <tr className="border-b border-ad-border">
                                            <th className="p-5 t-p-sm text-ad-muted font-medium w-[28%]">Feature</th>
                                            <th className="p-5 t-p-sm text-white-90 font-semibold text-center">Signal Free</th>
                                            <th className="p-5 t-p-sm text-white-90 font-semibold text-center">Signal $49</th>
                                            <th className="p-5 t-p-sm text-white-90 font-semibold text-center">Core Free</th>
                                            <th className="p-5 t-p-sm text-white-90 font-semibold text-center">Core $99</th>
                                            <th className="p-5 t-p-sm text-white-90 font-semibold text-center">Enterprise</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {comparisonRows.map((row) => (
                                            <tr key={row.feature} className="border-t border-ad-border/50">
                                                <td className="px-5 py-4 t-p-sm text-white-90">{row.feature}</td>
                                                <td className="px-5 py-4 text-center"><Cell value={row.sigFree} /></td>
                                                <td className="px-5 py-4 text-center"><Cell value={row.sigPaid} /></td>
                                                <td className="px-5 py-4 text-center"><Cell value={row.coreFree} /></td>
                                                <td className="px-5 py-4 text-center"><Cell value={row.corePaid} /></td>
                                                <td className="px-5 py-4 text-center"><Cell value={row.enterprise} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="px-5 py-4 t-p-sm text-ad-muted border-t border-ad-border/50">All prices in USD. Enterprise clients in Mexico may be invoiced in MXN at the prevailing exchange rate.</p>
                        </div>
                    </AnimatedSection>
                </Container>
            </section>

            {/* ── FAQ ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <SectionHeading
                            tag="FAQ"
                            tagIcon={<img src={pub("/images/svg/mH5OKmjNShfPxiFuUqwazYgcLNQ.svg")} alt="" width={24} height={24} />}
                            title="Common questions"
                            subtitle="Everything you need to know about Signal, Core, and Enterprise."
                            titleClassName="text-white-100"
                        />
                    </AnimatedSection>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl mx-auto">
                        <div className="space-y-4">
                            {faqs.slice(0, 5).map((item) => (
                                <AnimatedSection key={item.q}>
                                    <AccordionItem q={item.q} a={item.a} />
                                </AnimatedSection>
                            ))}
                        </div>
                        <div className="space-y-4">
                            {faqs.slice(5).map((item) => (
                                <AnimatedSection key={item.q}>
                                    <AccordionItem q={item.q} a={item.a} />
                                </AnimatedSection>
                            ))}
                        </div>
                    </div>
                </Container>
            </section>
        </>
    );
}
