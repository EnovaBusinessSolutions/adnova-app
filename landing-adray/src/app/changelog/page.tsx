"use client";

import React from "react";
import { motion } from "framer-motion";
import Container from "@/components/ui/Container";
import AnimatedSection from "@/components/ui/AnimatedSection";
import BlurRevealText from "@/components/ui/BlurRevealText";

const entries = [
    {
        version: "v1.2.0",
        date: "Feb 21, 2025",
        title: "Enhanced Real-Time Insights & Dashboard Overhaul",
        image: "https://framerusercontent.com/images/PzVlwHfZJnSzV7BVdS3yb4pUfs.png",
        features: [
            "Live dashboard metrics with sub-second refresh",
            "New customizable widget framework",
            "Advanced anomaly detection alerts",
            "Role-based dashboard access controls",
        ],
        body: [
            "This release marks a significant leap in how enterprise teams interact with real-time data. The overhauled dashboard engine now supports sub-second metric updates, giving decision-makers instant visibility into key business indicators without page refreshes or delays.",
            "Additionally, the new widget framework allows teams to build, share, and embed custom dashboard views — enabling personalized reporting for every department, from operations and finance to customer success.",
        ],
    },
    {
        version: "v1.1.3",
        date: "Jan 20, 2025",
        title: "Smart Alerts and Reporting Enhancements",
        image: "https://framerusercontent.com/images/lhnRueBH3t3YZE0C5xNYBUVwRrs.png",
        features: [
            "Threshold-based smart alerts",
            "Scheduled PDF and CSV report exports",
            "Alert escalation rules",
            "Multi-channel notification support (email, Slack, webhook)",
        ],
        body: [
            "Version 1.1.3 introduces a smarter alerting system designed for enterprise reliability. Teams can now define custom threshold rules for any metric, configure escalation paths, and receive real-time notifications through their preferred channels — including email, Slack, and custom webhooks.",
            "On the reporting side, users can now schedule automated report generation in PDF and CSV formats. Reports are delivered on a recurring basis to stakeholders, reducing manual effort and ensuring consistent visibility into performance trends.",
        ],
    },
    {
        version: "v1.1.0",
        date: "Dec 23, 2024",
        title: "Introducing Data Unification Engine",
        image: "https://framerusercontent.com/images/6XVR8y4c8VzMuBWy5Q2hb2WuD8.png",
        features: [
            "Cross-source data merging and deduplication",
            "Schema auto-detection and mapping",
            "Built-in connectors for 50+ enterprise tools",
            "Data lineage tracking and audit logs",
        ],
        body: [
            "The Data Unification Engine is the cornerstone of the v1.1.0 release. For the first time, teams can merge and deduplicate records across CRMs, ERPs, cloud storage, and internal databases — all without writing a single line of code.",
            "With schema auto-detection and intelligent field mapping, the engine eliminates the need for manual data transformations. Built-in connectors for 50+ enterprise tools ensure seamless plug-and-play setup, while full data lineage tracking gives compliance teams complete visibility into every data movement.",
        ],
    },
];

const ease = [0.21, 0.47, 0.32, 0.98] as const;

export default function ChangelogPage() {
    return (
        <>
            {/* ── Hero ── */}
            <section className="relative pt-40 pb-20 overflow-hidden">
                <Container className="relative z-10 text-center">
                    <motion.div
                        className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white-7 text-white-90 t-p-sm mb-6"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.6, ease }}
                    >
                        CHANGELOG
                    </motion.div>
                    <motion.h1
                        className="t-h1 text-white-90 mb-6"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.1, ease }}
                    >
                        <BlurRevealText text="Updates and Future Enhancements" startDelay={0.15} />
                    </motion.h1>
                    <motion.p
                        className="t-p-lg text-ad-subtitle max-w-2xl mx-auto"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.25, ease }}
                    >
                        See what&apos;s on our roadmap and what we&apos;ve shipped recently.
                    </motion.p>
                </Container>
            </section>

            {/* ── Changelog Entries ── */}
            <section className="py-20 relative">
                <Container>
                    <div className="flex flex-col gap-20 max-w-3xl mx-auto">
                        {entries.map((entry, i) => (
                            <AnimatedSection key={entry.version} delay={i * 0.1}>
                                <article>
                                    {/* Version + date */}
                                    <div className="flex items-center gap-4 mb-6">
                                        <span className="px-3 py-1 rounded-full text-sm font-semibold bg-white-7 border border-ad-border text-ad-primary">
                                            {entry.version}
                                        </span>
                                        <span className="t-p-sm text-ad-tag">
                                            {entry.date}
                                        </span>
                                    </div>

                                    {/* Title */}
                                    <h2 className="t-h2 text-white-90 mb-6">
                                        {entry.title}
                                    </h2>

                                    {/* Screenshot */}
                                    <div className="card overflow-hidden rounded-2xl mb-8">
                                        <img
                                            src={entry.image}
                                            alt={entry.title}
                                            className="w-full h-auto"
                                        />
                                    </div>

                                    {/* Feature bullets */}
                                    <ul className="space-y-3 mb-8">
                                        {entry.features.map((f) => (
                                            <li key={f} className="flex items-start gap-3">
                                                <span className="w-1.5 h-1.5 rounded-full bg-ad-primary shrink-0 mt-2" />
                                                <span className="t-p text-white-90">{f}</span>
                                            </li>
                                        ))}
                                    </ul>

                                    {/* Body paragraphs */}
                                    {entry.body.map((p, j) => (
                                        <p
                                            key={j}
                                            className="t-p text-ad-muted leading-relaxed mb-4"
                                        >
                                            {p}
                                        </p>
                                    ))}
                                </article>
                            </AnimatedSection>
                        ))}
                    </div>
                </Container>
            </section>
        </>
    );
}
