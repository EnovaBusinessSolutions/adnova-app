"use client";

import React, { useState } from "react";
import Container from "@/components/ui/Container";
import { pub } from "@/lib/paths";
import SectionHeading from "@/components/ui/SectionHeading";
import AnimatedSection from "@/components/ui/AnimatedSection";

/* ── tab data ─────────────────────────────────────────── */
const tabs = [
    {
        label: "Data Layer",
        title: "Unified Data Layer",
        description:
            "Reconcile Meta, Google, and Shopify into a single source of truth. Deduplicate conversions, resolve attribution conflicts, and build cross-merchant intelligence.",
        bullets: [
            "Reconcile Platforms \u2014 One source of truth",
            "Deduplicate Sales \u2014 Accurate attribution",
            "Cross-Merchant Intel \u2014 Benchmark your vertical",
        ],
        image:
            "https://framerusercontent.com/images/7vqU2Ppdy0G0UGP9mrAcNuH6Lo.png",
    },
    {
        label: "Visualization",
        title: "Dashboards + Creative",
        description:
            "Launch pre-built Looker Studio dashboards with one click. Push top-performing creative signals to Canva for smart ad creatives. Unlimited attribution history.",
        bullets: [
            "Looker Studio \u2014 One-click dashboards",
            "Canva Feed \u2014 Smart creative signals",
            "Unlimited History \u2014 Full attribution data",
        ],
        image:
            "https://framerusercontent.com/images/7vqU2Ppdy0G0UGP9mrAcNuH6Lo.png",
    },
    {
        label: "Agents",
        title: "Marketing Agent Stack",
        description:
            "Deploy agents that manage your ad spend autonomously. Budget reallocation, creative fatigue detection, anomaly alerts, and automated weekly reports \u2014 all running on your own LLM key.",
        bullets: [
            "Budget Agent \u2014 Reallocate spend in real time",
            "Creative Agent \u2014 Detect fatigue early",
            "Report Agent \u2014 Weekly insights on autopilot",
        ],
        image:
            "https://framerusercontent.com/images/7vqU2Ppdy0G0UGP9mrAcNuH6Lo.png",
    },
];

/* ── product cards ────────────────────────────────────── */
const products = [
    {
        name: "Attribution",
        description: "Know exactly which ads drive real revenue.",
        icon: pub("/images/svg/UhzKcwOlsFcygmiTZBSV1TlJWI.svg"),
    },
    {
        name: "ROAS Tracking",
        description: "See your true return on ad spend across platforms.",
        icon: pub("/images/svg/xjQCmHyjo6JeuuaTw7eNj6Rnz0.svg"),
    },
    {
        name: "Ad Intelligence",
        description: "Cross-platform insights for smarter ad decisions.",
        icon: pub("/images/svg/g03jLOH8iFVEwvrXTl5O92yNWI.svg"),
    },
    {
        name: "Budget Optimization",
        description: "AI agents that manage your ad spend 24/7.",
        icon: pub("/images/svg/s0leRkmxKn90KJPse58Uwi0gmwA.svg"),
    },
];

/* ── Checkmark SVG ────────────────────────────────────── */
function CheckIcon() {
    return (
        <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
            <path
                d="M1.5 5.5L5.5 9.5L13.5 1.5"
                stroke="black"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/* ── Component ────────────────────────────────────────── */
export default function Products() {
    const [active, setActive] = useState(0);
    const tab = tabs[active];

    return (
        <section className="py-20 relative overflow-hidden">
            {/* Background gradient */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src="https://framerusercontent.com/images/PEUUUxYckhxt8G82fn4Y0LPz5s.png"
                alt=""
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={{ opacity: 0.6, zIndex: 0, minWidth: "2058px", left: "50%", transform: "translateX(-50%)", filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
            />

            <Container className="relative z-10">
                <AnimatedSection>
                    <SectionHeading
                        tag="PRODUCTS"
                        tagIcon={
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={pub("/images/svg/MRmuOBoDk7tTbd9wZjGly9VAk.svg")}
                                alt=""
                                width={24}
                                height={24}
                            />
                        }
                        title="The Full Product Stack"
                        subtitle="Five layers of ecommerce intelligence. You own the data. AI does the rest."
                    />
                </AnimatedSection>

                {/* ── Tabbed content panel ─────────────────── */}
                <AnimatedSection delay={0.15}>
                    {/* Pill tabs */}
                    <div className="flex justify-center mb-8">
                        <div className="inline-flex gap-2 p-1 rounded-2xl">
                            {tabs.map((t, i) => (
                                <button
                                    key={t.label}
                                    onClick={() => setActive(i)}
                                    className={`px-5 py-2.5 rounded-full border text-sm font-medium transition-all duration-200 cursor-pointer
                                        ${i === active
                                            ? "bg-white-100 text-black-100 border-ad-border"
                                            : "bg-white-7 text-white-90 border-ad-border hover:bg-white-10"
                                        }`}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Content card */}
                    <div
                        className="rounded-3xl border border-ad-border overflow-hidden flex flex-col lg:flex-row"
                        style={{ background: "transparent" }}
                    >
                        {/* Left: text */}
                        <div className="flex-1 p-6 md:p-8 lg:p-10 flex flex-col justify-center">
                            <h4 className="t-h4 text-white-90 mb-3">{tab.title}</h4>
                            <p className="t-p text-ad-subtitle mb-8">{tab.description}</p>

                            <div className="flex flex-col gap-3">
                                {tab.bullets.map((bullet) => (
                                    <div
                                        key={bullet}
                                        className="flex items-center gap-3 rounded-xl border border-ad-border px-4 py-3"
                                    >
                                        <span className="t-p text-white-90 flex-1">{bullet}</span>
                                        <span
                                            className="w-7 h-7 rounded-[10px] flex items-center justify-center shrink-0"
                                            style={{
                                                background: "rgba(255,255,255,0.1)",
                                                boxShadow: "inset 0px 0px 4px 0px rgba(255,255,255,0.31)",
                                            }}
                                        >
                                            <CheckIcon />
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Right: dashboard image */}
                        <div className="flex-1 relative min-h-[220px] lg:min-h-[380px] flex items-center justify-center">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={tab.image}
                                alt={tab.title}
                                className="w-full h-full object-contain"
                                style={{
                                    filter: "drop-shadow(-16px 11px 7px rgba(0,0,0,0.18))",
                                }}
                            />
                        </div>
                    </div>
                </AnimatedSection>

                {/* ── Product cards ────────────────────────── */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12">
                    {products.map((product, i) => (
                        <AnimatedSection key={product.name} delay={0.1 + i * 0.08}>
                            <div className="flex flex-col md:flex-row items-start md:items-center gap-4 p-5">
                                {/* Icon with gradient border */}
                                <div
                                    className="rounded-3xl p-px shrink-0"
                                    style={{
                                        background:
                                            "linear-gradient(40deg, rgb(62,40,111) 0%, rgb(15,11,20) 45%, rgb(181,92,255) 100%)",
                                        boxShadow: "0px 6px 24px 0px rgba(62,40,111,0.35)",
                                    }}
                                >
                                    <div
                                        className="rounded-3xl p-3 flex items-center justify-center"
                                        style={{ backgroundColor: "var(--ad-dark)" }}
                                    >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={product.icon}
                                            alt={product.name}
                                            width={24}
                                            height={24}
                                            className="block"
                                        />
                                    </div>
                                </div>
                                {/* Text */}
                                <div className="flex flex-col gap-1">
                                    <h4 className="text-white-90 font-semibold text-sm">{product.name}</h4>
                                    <p className="text-ad-tag text-xs leading-relaxed">{product.description}</p>
                                </div>
                            </div>
                        </AnimatedSection>
                    ))}
                </div>
            </Container>
        </section>
    );
}
