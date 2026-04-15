"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Check, X, Plus, Minus } from "lucide-react";
import Container from "@/components/ui/Container";
import SectionHeading from "@/components/ui/SectionHeading";
import AnimatedSection from "@/components/ui/AnimatedSection";
import Button from "@/components/ui/Button";
import { brandify } from "@/lib/utils";
import { pub } from "@/lib/paths";

/* ── Plans ── */
const plans: Array<{
    name: string;
    monthlyPrice: number | null;
    subtitle?: string;
    features: string[];
    trust: string | null;
    bgImage: string;
    ctaHref: string;
}> = [
    {
        name: "Free",
        monthlyPrice: 0,
        features: [
            "Shopify app + auto-install pixel",
            "Meta + Google ad connectors",
            "MCP endpoint for ChatGPT, Claude, Gemini",
            "Pre-built prompt templates",
            "Limited attribution window",
            "Community support",
        ],
        trust: "850+ merchants connected",
        bgImage:
            "https://framerusercontent.com/images/XXSw2JqvtikgOcaexTTozzVsO54.webp",
        ctaHref: "/login",
    },
    {
        name: "Pro",
        monthlyPrice: 49,
        features: [
            "Everything in Free",
            "Looker Studio connector + dashboards",
            "Canva creative feed for smart ads",
            "Unlimited attribution history",
            "Priority email support",
            "Direct onboarding path",
        ],
        trust: "For growing brands",
        bgImage:
            "https://framerusercontent.com/images/4fEwCxLuKCW6ZaczMzoeCElmzBg.webp",
        ctaHref: "/login",
    },
    {
        name: "Agent Stack",
        monthlyPrice: null,
        subtitle: "AI agents that manage your ad spend. Priced on value delivered.",
        features: [
            "Budget reallocation agent",
            "Creative fatigue detection agent",
            "Anomaly detection + alerting",
            "Weekly reporting agent",
            "Runs on your own LLM key",
        ],
        trust: null,
        bgImage:
            "https://framerusercontent.com/images/K53jEm1inmwk6lcSyDVU5W7rvLM.webp",
        ctaHref: "/contact",
    },
];

/* ── Comparison Table ── */
type CellValue = boolean | string;

interface ComparisonRow {
    feature: string;
    basic: CellValue;
    standard: CellValue;
    enterprise: CellValue;
}

const essentialFeatures: ComparisonRow[] = [
    { feature: "Server-side pixel (auto-install)", basic: true, standard: true, enterprise: true },
    { feature: "Meta + Google ad connectors", basic: true, standard: true, enterprise: true },
    { feature: "MCP endpoint for LLMs", basic: true, standard: true, enterprise: true },
    { feature: "Pre-built prompt templates", basic: true, standard: true, enterprise: true },
    { feature: "Unlimited attribution history", basic: false, standard: true, enterprise: true },
];

const advancedFeatures: ComparisonRow[] = [
    { feature: "Looker Studio dashboards", basic: false, standard: true, enterprise: true },
    { feature: "Canva creative feed", basic: false, standard: true, enterprise: true },
    { feature: "Budget reallocation agent", basic: false, standard: false, enterprise: true },
    { feature: "Creative fatigue detection", basic: false, standard: false, enterprise: true },
    { feature: "Anomaly alerts + weekly reports", basic: false, standard: false, enterprise: true },
];

/* ── FAQ ── */
const faqs = [
    {
        q: "What is Adray?",
        a: "Adray is a free ecommerce data layer that reconciles your Meta, Google, and Shopify data into one source of truth. Connect it to ChatGPT, Claude, or Gemini via MCP and get real attribution insights \u2014 no new dashboard to learn.",
    },
    {
        q: "How is Adray different from Triple Whale or Northbeam?",
        a: "Those tools are paid dashboards you have to learn and log into. Adray is free infrastructure \u2014 we own the data layer, and you analyze it with the AI tools you already use. No new UI, no monthly dashboard fee, and our server-side pixel captures 30\u201340% more events.",
    },
    {
        q: "What platforms does Adray connect to?",
        a: "Adray connects to Meta Ads, Google Ads, and Shopify out of the box. WooCommerce and BigCommerce connectors are coming soon. On the AI side, we support ChatGPT, Claude, and Gemini via MCP protocol.",
    },
    {
        q: "Is my ad data secure?",
        a: "Yes. All data is collected server-side and encrypted at rest and in transit. Our pixel never touches the browser, making it immune to iOS privacy changes and ad blockers. Your data stays yours.",
    },
    {
        q: "How quickly can I set up Adray?",
        a: "Under 5 minutes. Install from the Shopify App Store, connect your ad accounts via OAuth, and your MCP endpoint is ready. No code, no JavaScript, no developer needed.",
    },
    {
        q: "What are Adray marketing agents?",
        a: "Marketing agents are AI-powered automations that act on your data \u2014 reallocating budgets, detecting creative fatigue, flagging anomalies, and generating weekly reports. They run on your own LLM key, so there\u2019s near-zero cost to Adray.",
    },
    {
        q: "What does the free plan include?",
        a: "The free plan includes the Shopify app with auto-install pixel, Meta and Google connectors, an MCP endpoint for any major LLM, pre-built prompt templates, and a limited attribution window. No credit card required.",
    },
    {
        q: "What\u2019s the $49 Pro plan for?",
        a: "Pro unlocks Looker Studio dashboards, Canva creative feed integration, unlimited attribution history, and priority support. It\u2019s built for merchants who want the full visualization and creative workflow on top of the free data layer.",
    },
];

const ease = [0.21, 0.47, 0.32, 0.98] as const;

function CellDisplay({ value }: { value: CellValue }) {
    if (value === true)
        return <Check size={18} className="text-ad-primary mx-auto" />;
    if (value === false)
        return <X size={18} className="text-ad-muted/40 mx-auto" />;
    return <span className="t-p-sm text-white-90">{value}</span>;
}

function AccordionItem({ q, a }: { q: string; a: string }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="rounded-[24px] border border-ad-border bg-ad-dark overflow-hidden transition-all duration-300">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between p-6 text-left cursor-pointer"
            >
                <span className="t-p font-medium text-white-90 pr-4">{brandify(q)}</span>
                <span className="w-8 h-8 rounded-full bg-white-7 border border-ad-border flex items-center justify-center shrink-0">
                    {open ? <Minus size={14} className="text-white-90" /> : <Plus size={14} className="text-white-90" />}
                </span>
            </button>
            <div className={`overflow-hidden transition-all duration-300 ${open ? "max-h-96 opacity-100" : "max-h-0 opacity-0"}`}>
                <p className="px-6 pb-6 t-p-sm text-ad-muted leading-relaxed">{brandify(a)}</p>
            </div>
        </div>
    );
}

export default function PricingPage() {
    return (
        <>
            {/* ── Hero ── */}
            <section className="relative pt-40 pb-10 overflow-hidden">
                {/* Background gradient */}
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
                        <img
                            src={pub("/images/svg/3UovOTKirX07vhyWYJGSliEt1E4.svg")}
                            alt=""
                            width={24}
                            height={24}
                            className="opacity-80"
                        />
                        <span className="t-p-sm uppercase tracking-widest text-white-90">PRICING</span>
                    </motion.div>
                    <motion.h1
                        className="t-h1 text-white-100 mb-6"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.1, ease }}
                    >
                        Flexible Plans for Every Merchant
                    </motion.h1>
                    <motion.p
                        className="t-p-lg text-ad-subtitle max-w-2xl mx-auto"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.25, ease }}
                    >
                        Free to start. $49 for the full workflow. Agents priced on value delivered.
                    </motion.p>
                </Container>
            </section>

            {/* ── Toggle + Cards ── */}
            <section className="py-10 relative">
                <Container>
                    <AnimatedSection>
                        <SectionHeading
                            tag="PLANS"
                            title="Pick Your Plan"
                            subtitle="Start free. Upgrade when you need the full workflow or agent stack."
                            titleClassName="text-white-100"
                            tagIcon={
                                <img
                                    src={pub("/images/svg/jQJ8TgGax14f2upuHQKSjpr1jmg.svg")}
                                    alt=""
                                    width={24}
                                    height={24}
                                />
                            }
                        />
                    </AnimatedSection>

                    {/* Plan cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {plans.map((plan, i) => (
                            <AnimatedSection key={plan.name} delay={i * 0.12}>
                                <div className="card relative overflow-hidden h-full flex flex-col">
                                    <img
                                        src={plan.bgImage}
                                        alt=""
                                        className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                                        style={{ filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                                    />
                                    <div className="relative z-10 p-8 flex flex-col h-full">
                                        {plan.monthlyPrice !== null ? (
                                            <>
                                                <h3 className="t-h4 text-white-90">{plan.name}</h3>
                                                <div className="mt-3 flex items-baseline gap-1">
                                                    <span className="text-4xl font-bold text-white-90">
                                                        ${plan.monthlyPrice}
                                                    </span>
                                                    <span className="text-ad-muted t-p-sm">
                                                        /month
                                                    </span>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <p className="t-h4 text-gradient">Per agent pricing</p>
                                                <h3 className="t-h3 text-white-90 mt-2">{plan.name}</h3>
                                            </>
                                        )}

                                        {plan.subtitle && (
                                            <p className="mt-2 t-p-sm text-ad-muted">{plan.subtitle}</p>
                                        )}

                                        <div className="mt-6 mb-8">
                                            <Button variant="primary" href={plan.ctaHref} className="w-full whitespace-nowrap min-h-[48px]">
                                                Get Started
                                            </Button>
                                        </div>

                                        <ul className="space-y-3 mt-auto">
                                            {plan.features.map((f) => (
                                                <li key={f} className="flex items-start gap-3">
                                                    <Check size={16} className="text-ad-primary shrink-0 mt-0.5" />
                                                    <span className="t-p-sm text-white-90">{f}</span>
                                                </li>
                                            ))}
                                        </ul>

                                        {plan.trust && (
                                            <p className="mt-8 t-p-sm text-ad-muted text-center">
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

            {/* ── Comparison Table ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <SectionHeading
                            tag="COMPARISON"
                            tagIcon={
                                <img
                                    src={pub("/images/svg/X5M3y8eb51ZE3hAx5kOkcLqc83U.svg")}
                                    alt=""
                                    width={24}
                                    height={24}
                                />
                            }
                            title="Compare Plans"
                            subtitle="See what each plan includes across data, visualization, and agents."
                        />
                    </AnimatedSection>

                    <AnimatedSection delay={0.15}>
                        <div className="card overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="border-b border-ad-border">
                                            <th className="p-6 t-p-sm text-ad-muted font-medium w-1/3">Feature</th>
                                            <th className="p-6 t-p-sm text-white-90 font-semibold text-center">Free</th>
                                            <th className="p-6 t-p-sm text-white-90 font-semibold text-center">Pro</th>
                                            <th className="p-6 t-p-sm text-white-90 font-semibold text-center">Agent Stack</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {/* Essential */}
                                        <tr>
                                            <td
                                                colSpan={4}
                                                className="px-6 pt-6 pb-3 t-p-sm uppercase tracking-widest text-ad-tag font-medium"
                                            >
                                                Essential features
                                            </td>
                                        </tr>
                                        {essentialFeatures.map((row) => (
                                            <tr key={row.feature} className="border-t border-ad-border/50">
                                                <td className="px-6 py-4 t-p-sm text-white-90">{row.feature}</td>
                                                <td className="px-6 py-4 text-center"><CellDisplay value={row.basic} /></td>
                                                <td className="px-6 py-4 text-center"><CellDisplay value={row.standard} /></td>
                                                <td className="px-6 py-4 text-center"><CellDisplay value={row.enterprise} /></td>
                                            </tr>
                                        ))}

                                        {/* Advanced */}
                                        <tr>
                                            <td
                                                colSpan={4}
                                                className="px-6 pt-8 pb-3 t-p-sm uppercase tracking-widest text-ad-tag font-medium"
                                            >
                                                Pro + Agent features
                                            </td>
                                        </tr>
                                        {advancedFeatures.map((row) => (
                                            <tr key={row.feature} className="border-t border-ad-border/50">
                                                <td className="px-6 py-4 t-p-sm text-white-90">{row.feature}</td>
                                                <td className="px-6 py-4 text-center"><CellDisplay value={row.basic} /></td>
                                                <td className="px-6 py-4 text-center"><CellDisplay value={row.standard} /></td>
                                                <td className="px-6 py-4 text-center"><CellDisplay value={row.enterprise} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </AnimatedSection>
                </Container>
            </section>

            {/* ── Decorative gradient ── */}
            <div className="relative w-full flex items-center justify-center overflow-hidden" style={{ height: 0 }}>
                <img
                    src="https://framerusercontent.com/images/PEUUUxYckhxt8G82fn4Y0LPz5s.png"
                    alt=""
                    className="absolute pointer-events-none"
                    style={{ width: 3296, height: 2255, transform: "translate(-50%, -50%)", left: "50%", top: "50%", filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                />
            </div>

            {/* ── FAQ ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <SectionHeading
                            tag="FAQ"
                            tagIcon={
                                <img
                                    src={pub("/images/svg/mH5OKmjNShfPxiFuUqwazYgcLNQ.svg")}
                                    alt=""
                                    width={24}
                                    height={24}
                                />
                            }
                            title="Curious About Adray?"
                            subtitle="Answers to common questions about our ecommerce data platform."
                            titleClassName="text-white-100"
                        />
                    </AnimatedSection>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                        <div className="space-y-4">
                            {faqs.slice(0, 4).map((item) => (
                                <AnimatedSection key={item.q}>
                                    <AccordionItem q={item.q} a={item.a} />
                                </AnimatedSection>
                            ))}
                        </div>
                        <div className="space-y-4">
                            {faqs.slice(4, 8).map((item) => (
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
