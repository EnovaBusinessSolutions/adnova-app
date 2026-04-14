"use client";

import React from "react";
import Container from "@/components/ui/Container";
import SectionHeading from "@/components/ui/SectionHeading";
import AnimatedSection from "@/components/ui/AnimatedSection";
import { pub } from "@/lib/paths";

const features = [
    {
        icon: pub("/images/svg/TRt8OkZ1B4j7B4TuuIPjZZ0f8.svg"),
        label: "Intelligent Protection",
    },
    {
        icon: pub("/images/svg/TRt8OkZ1B4j7B4TuuIPjZZ0f8.svg"),
        label: "Real-Time Threat Detection",
    },
    {
        icon: pub("/images/svg/TRt8OkZ1B4j7B4TuuIPjZZ0f8.svg"),
        label: "Seamless Compliance",
    },
];

export default function DataPrivacy() {
    return (
        <section className="py-20 relative">
            <Container>
                <div className="flex flex-col lg:flex-row gap-12 lg:gap-16 items-center">
                    {/* Left — text + feature rows */}
                    <div className="flex-1 min-w-0">
                        <AnimatedSection>
                            <SectionHeading
                                tag="DATA AND PRIVACY"
                                tagIcon={
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={pub("/images/svg/TRt8OkZ1B4j7B4TuuIPjZZ0f8.svg")}
                                        alt=""
                                        width={24}
                                        height={24}
                                    />
                                }
                                title="Multi-Layer Security"
                                subtitle="Protect your enterprise with multi-layered AI security. From data encryption to behavior monitoring, every layer works together."
                                titleClassName="text-white-100"
                                align="left"
                            />
                        </AnimatedSection>

                        <AnimatedSection delay={0.1}>
                            <div className="flex flex-col gap-4">
                                {features.map((f) => (
                                    <div
                                        key={f.label}
                                        className="flex items-center gap-3 px-5 py-4 rounded-xl border border-ad-border bg-white-7"
                                    >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={f.icon} alt="" width={20} height={20} className="opacity-80" />
                                        <span className="t-p-medium text-white-90">{f.label}</span>
                                    </div>
                                ))}
                            </div>
                        </AnimatedSection>
                    </div>

                    {/* Right — perspective layer cards */}
                    <div className="flex-1 min-w-0 flex justify-end">
                        <AnimatedSection delay={0.2}>
                            <div
                                style={{
                                    position: "relative",
                                    width: "min(34rem, 90vw)",
                                    height: "24rem",
                                    perspective: "60rem",
                                    perspectiveOrigin: "50% 50%",
                                    marginRight: "-2rem",
                                }}
                            >
                                {[0, 1, 2, 3].map((i) => {
                                    const gradients = [
                                        "radial-gradient(ellipse at 30% 50%, #CA8AE5 0%, #B55CFF 30%, #3E286F 60%, #0F0B14 100%)",
                                        "radial-gradient(ellipse at 40% 40%, #E1D8F3 0%, #CA8AE5 35%, #3E286F 65%, #0F0B14 100%)",
                                        "radial-gradient(ellipse at 50% 50%, #E1D8F3 0%, #B55CFF 30%, #3E286F 60%, #100C12 100%)",
                                        "radial-gradient(ellipse at 60% 60%, #E1D8F3 0%, #CA8AE5 30%, #B55CFF 60%, #3E286F 100%)",
                                    ];
                                    const opacities = [1, 0.85, 0.65, 0.45];
                                    return (
                                        <div
                                            key={i}
                                            style={{
                                                position: "absolute",
                                                top: 0,
                                                left: `${i * 14}%`,
                                                width: "48%",
                                                height: "100%",
                                                transform: `rotateY(-20deg) translateZ(${(3 - i) * 2}rem)`,
                                                transformStyle: "preserve-3d",
                                                borderRadius: "0.75rem",
                                                overflow: "hidden",
                                                border: "0.06rem solid rgba(255,255,255,0.12)",
                                                background: gradients[i],
                                                opacity: opacities[i],
                                            }}
                                        >
                                            {/* Glow flash overlay */}
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    inset: 0,
                                                    background: "radial-gradient(ellipse at 40% 40%, rgba(225,216,243,0.5) 0%, rgba(202,138,229,0.25) 50%, transparent 80%)",
                                                    animation: `layer-flash 4s ease-in-out ${i * 0.6}s infinite`,
                                                    pointerEvents: "none",
                                                }}
                                            />

                                            {/* Border glow on flash */}
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    inset: 0,
                                                    borderRadius: "inherit",
                                                    boxShadow:
                                                        "inset 0 0 2rem rgba(202,138,229,0.2), 0 0 1.5rem rgba(181,92,255,0.12)",
                                                    animation: `layer-flash 4s ease-in-out ${i * 0.6}s infinite`,
                                                    pointerEvents: "none",
                                                }}
                                            />
                                        </div>
                                    );
                                })}

                                {/* Ambient glow behind the stack */}
                                <div
                                    style={{
                                        position: "absolute",
                                        top: "10%",
                                        left: "15%",
                                        width: "70%",
                                        height: "80%",
                                        background: "radial-gradient(ellipse, rgba(202,138,229,0.18) 0%, transparent 70%)",
                                        filter: "blur(2.5rem)",
                                        animation: "layer-ambient 4s ease-in-out infinite",
                                        pointerEvents: "none",
                                        zIndex: -1,
                                    }}
                                />
                            </div>
                        </AnimatedSection>
                    </div>
                </div>
            </Container>
        </section>
    );
}
