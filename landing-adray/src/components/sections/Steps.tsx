"use client";

import React, { useRef, useState } from "react";
import { motion, useScroll, useTransform, useMotionValueEvent } from "framer-motion";
import Container from "@/components/ui/Container";
import SectionHeading from "@/components/ui/SectionHeading";
import AnimatedSection from "@/components/ui/AnimatedSection";
import { pub } from "@/lib/paths";

const steps = [
    {
        number: "01",
        title: "Create your account",
        description: "",
        bullets: [
            "Free forever — no credit card needed.",
            "Account ready in under 30 seconds.",
            "Start connecting platforms immediately.",
        ],
        image: pub("/images/Connect.zip%20-%202.png"),
    },
    {
        number: "02",
        title: "Connect your stack",
        description: "",
        bullets: [
            "Connect Meta Ads, Google Ads, and GA4.",
            "No code. No credentials to copy-paste.",
            "Your Signal starts building the moment your first source connects.",
        ],
        image: pub("/images/Connect.zip%20-%201.png"),
    },
    {
        number: "03",
        title: "Deploy your Signal",
        description: "",
        bullets: [
            "Download your daily Signal PDF.",
            "Attach it to Claude, ChatGPT, Gemini, or any AI you already use.",
            "Ask real questions. Get answers backed by reconciled data.",
        ],
        image: pub("/images/Connect.zip%20-%203.png"),
    },
];

function StepCard({ step }: { step: (typeof steps)[0] }) {
    const isVideo = step.image.toLowerCase().endsWith(".webm");

    return (
        <div className="card overflow-hidden flex flex-col md:flex-row">
            {/* Text content */}
            <div className="flex-1 p-6 md:p-8">
                <h3 className="t-h4 text-white-100 mb-4">{step.title}</h3>
                {step.description && <p className="t-p text-ad-muted mb-6">{step.description}</p>}
                <ul className="space-y-3">
                    {step.bullets.map((bullet) => (
                        <li key={bullet} className="flex items-start gap-3">
                            <div className="w-5 h-5 rounded-full bg-white-10 flex items-center justify-center shrink-0 mt-0.5">
                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                    <defs>
                                        <linearGradient id="checkGrad" x1="0" y1="0" x2="10" y2="8" gradientUnits="userSpaceOnUse">
                                            <stop stopColor="#CA8AE5" />
                                            <stop offset="1" stopColor="#3E286F" />
                                        </linearGradient>
                                    </defs>
                                    <path
                                        d="M1 4L3.5 6.5L9 1"
                                        stroke="url(#checkGrad)"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </div>
                            <span className="t-p text-white-90">{bullet}</span>
                        </li>
                    ))}
                </ul>
            </div>
            {/* Image */}
            <div
                className="flex-1 relative min-h-[200px] md:min-h-0"
                style={{
                    maskImage: "linear-gradient(90deg, transparent 0%, black 11%, black 100%)",
                    WebkitMaskImage: "linear-gradient(90deg, transparent 0%, black 11%, black 100%)",
                }}
            >
                {isVideo ? (
                    <video
                        src={step.image}
                        className="w-full h-full object-cover"
                        style={{ filter: "brightness(1.5) sepia(1) hue-rotate(230deg) saturate(2)" }}
                        autoPlay
                        loop
                        muted
                        playsInline
                    />
                ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={step.image}
                        alt={step.title}
                        className="w-full h-full object-cover"
                        style={{ filter: "brightness(1.5) sepia(1) hue-rotate(230deg) saturate(2)" }}
                    />
                )}
            </div>
        </div>
    );
}

export default function Steps() {
    const sectionRef = useRef<HTMLDivElement>(null);
    const [activeStep, setActiveStep] = useState(0);
    const { scrollYProgress } = useScroll({
        target: sectionRef,
        offset: ["start center", "end center"],
    });

    // Derive active step index from scroll progress (0-0.33 → step 0, 0.33-0.66 → step 1, 0.66-1.0 → step 2)
    useMotionValueEvent(scrollYProgress, "change", (v) => {
        const idx = v < 0.33 ? 0 : v < 0.66 ? 1 : 2;
        setActiveStep(idx);
    });

    // Beam slides to align with the active number (0%, 100%, 200%)
    const beamX = useTransform(scrollYProgress, [0, 0.33, 0.34, 0.66, 0.67, 1], ["0%", "0%", "100%", "100%", "200%", "200%"]);

    return (
        <section className="py-20 relative" id="how-it-works" ref={sectionRef}>
            <Container>
                <AnimatedSection>
                    <SectionHeading
                        tag="HOW IT WORKS"
                        tagIcon={
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={pub("/images/svg/lwNa4WCrpY0HtXMtN0IteQrJig.svg")}
                                alt=""
                                width={24}
                                height={24}
                            />
                        }
                        title="Three steps. One Signal. Any&nbsp;AI."
                        subtitle=""
                        titleClassName="text-white-100 lg:whitespace-nowrap"
                    />
                </AnimatedSection>

                {/* Desktop: full-width number bar + stacking cards */}
                <div className="hidden lg:block">
                    {/* Sticky number bar */}
                    <div className="sticky top-0 z-20 bg-background pt-20 pb-6">
                        <div className="flex items-center max-w-md mx-auto">
                            {steps.map((step, i) => (
                                <span
                                    key={step.number}
                                    className={`flex-1 text-center t-h3-lg font-bold transition-all duration-500 ${i === activeStep ? "text-gradient" : "text-ad-deep"
                                        }`}
                                >
                                    {step.number}.
                                </span>
                            ))}
                        </div>
                        {/* Beam line */}
                        <div className="relative h-[2px] mt-4 overflow-hidden rounded-full max-w-md mx-auto" style={{ background: "rgba(62, 40, 111, 0.35)" }}>
                            <motion.div
                                className="absolute inset-y-0 w-1/3"
                                style={{
                                    x: beamX,
                                    background: "linear-gradient(90deg, #B55CFF 0%, #3E286F 100%)",
                                    height: "2px",
                                }}
                            />
                        </div>
                    </div>

                    {/* Stacking cards — all sticky elements must be siblings in the same parent */}
                    {steps.map((step, i) => (
                        <React.Fragment key={step.number}>
                            <div
                                className="sticky top-[160px]"
                                style={{ zIndex: 10 + i }}
                            >
                                <div className="bg-background pt-2 pb-6">
                                    <StepCard step={step} />
                                </div>
                            </div>
                            {/* Spacer between cards for scroll room — not on the last card */}
                            {i < steps.length - 1 && <div className="h-[40vh]" />}
                        </React.Fragment>
                    ))}
                </div>

                {/* Mobile: stacked vertically */}
                <div className="lg:hidden space-y-12">
                    {steps.map((step) => (
                        <AnimatedSection key={step.number} delay={0.1}>
                            <div className="flex items-center gap-4 mb-4">
                                <span className="t-h3-lg text-gradient font-bold">
                                    {step.number}.
                                </span>
                                <div className="h-px flex-1 bg-ad-border relative overflow-hidden">
                                    <div
                                        className="absolute inset-y-0 left-0 w-16 animate-beam"
                                        style={{
                                            background: "linear-gradient(90deg, transparent, #B55CFF, transparent)",
                                        }}
                                    />
                                </div>
                            </div>
                            <StepCard step={step} />
                        </AnimatedSection>
                    ))}
                </div>

                <AnimatedSection delay={0.3}>
                    <p className="text-center t-p-sm text-ad-muted mt-12">
                        🔌 MCP connector for Claude — live now. ChatGPT and Gemini coming Q2 2026.
                    </p>
                </AnimatedSection>
            </Container>
        </section>
    );
}
