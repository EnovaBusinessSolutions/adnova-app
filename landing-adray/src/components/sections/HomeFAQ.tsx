"use client";

import React, { useState } from "react";
import { Plus, Minus } from "lucide-react";
import Container from "@/components/ui/Container";
import { pub } from "@/lib/paths";
import SectionHeading from "@/components/ui/SectionHeading";
import AnimatedSection from "@/components/ui/AnimatedSection";
import { brandify } from "@/lib/utils";

const part1 = [
    {
        q: "What is Adray?",
        a: "Adray is a marketing intelligence platform that connects to your ad accounts, reconciles spend against verified revenue, and delivers a structured daily Signal \u2014 ready to use in any AI you already work with. MCP connectors coming in Q2 2026.",
    },
    {
        q: "Who is Adray for?",
        a: "Any business running digital ads across Meta, Google, or GA4. Performance marketers, growth teams, media buyers, and agencies who need clean, AI-ready data without a new dashboard to manage.",
    },
    {
        q: "How is this different from Triple Whale?",
        a: "Triple Whale is a Shopify-native analytics dashboard. Adray doesn\u2019t require Shopify, doesn\u2019t ask you to log into another interface, and delivers its intelligence directly to the AI you already use \u2014 not into another reporting tool.",
    },
    {
        q: "How is this different from Windsor.ai?",
        a: "Windsor pulls raw data from your platforms and routes it to a destination. Adray reconciles it \u2014 removing refunded revenue, normalizing cross-platform metrics, and verifying buyer type \u2014 before it reaches your AI. The difference is data quality, not data volume.",
    },
];

const part2 = [
    {
        q: "Do I need to install the pixel to get value?",
        a: "No. Connect Meta, Google Ads, and GA4 via OAuth and your Signal starts building immediately. The pixel deepens attribution \u2014 it doesn\u2019t enable it.",
    },
    {
        q: "How does the pixel install work?",
        a: "Two clicks via Google Tag Manager, or paste a single script into your site. No developer required. Works on any website.",
    },
    {
        q: "How fast is setup?",
        a: "Account creation takes under 30 seconds. OAuth connection takes under two minutes. Your first Signal PDF is ready within the hour.",
    },
];

function AccordionItem({ q, a }: { q: string; a: string }) {
    const [open, setOpen] = useState(false);

    return (
        <div
            className="rounded-[24px] border border-ad-border bg-ad-dark overflow-hidden transition-all duration-300"
        >
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between p-6 text-left cursor-pointer"
            >
                <span className="t-p font-medium text-white-90 pr-4">{brandify(q)}</span>
                <span className="w-8 h-8 rounded-full bg-white-7 border border-ad-border flex items-center justify-center shrink-0">
                    {open ? (
                        <Minus size={14} className="text-white-90" />
                    ) : (
                        <Plus size={14} className="text-white-90" />
                    )}
                </span>
            </button>
            <div
                className={`overflow-hidden transition-all duration-300 ${open ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                    }`}
            >
                <p className="px-6 pb-6 t-p-sm text-ad-muted leading-relaxed">
                    {brandify(a)}
                </p>
            </div>
        </div>
    );
}

export default function HomeFAQ() {
    return (
        <section className="py-20 relative">
            <Container>
                <AnimatedSection>
                    <SectionHeading
                        tag="FAQ"
                        tagIcon={
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={pub("/images/svg/mH5OKmjNShfPxiFuUqwazYgcLNQ.svg")}
                                alt=""
                                width={24}
                                height={24}
                            />
                        }
                        title="Commonly asked questions"
                        subtitle=""
                        titleClassName="text-white-100"
                    />
                </AnimatedSection>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Part 01 */}
                    <div>
                        <p className="t-p-sm text-ad-muted uppercase tracking-widest mb-6">
                            Part 01
                        </p>
                        <div className="space-y-4">
                            {part1.map((item) => (
                                <AnimatedSection key={item.q}>
                                    <AccordionItem q={item.q} a={item.a} />
                                </AnimatedSection>
                            ))}
                        </div>
                    </div>

                    {/* Part 02 */}
                    <div>
                        <p className="t-p-sm text-ad-muted uppercase tracking-widest mb-6">
                            Part 02
                        </p>
                        <div className="space-y-4">
                            {part2.map((item) => (
                                <AnimatedSection key={item.q}>
                                    <AccordionItem q={item.q} a={item.a} />
                                </AnimatedSection>
                            ))}
                        </div>
                    </div>
                </div>
            </Container>
        </section>
    );
}
