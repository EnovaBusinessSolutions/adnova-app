"use client";

import React from "react";
import { motion } from "framer-motion";
import Container from "@/components/ui/Container";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import BlurRevealText from "@/components/ui/BlurRevealText";
import { pub } from "@/lib/paths";

const partnerLogos = [
    { name: "Meta Ads", icon: pub("/images/svg/meta.svg") },
    { name: "Google Ads", icon: pub("/images/svg/google-ads.svg") },
    { name: "Google Analytics", icon: pub("/images/svg/ga4.svg") },
    { name: "Shopify", icon: pub("/images/svg/shopify.svg") },
    { name: "ChatGPT", icon: pub("/images/svg/chatgpt.svg") },
    { name: "Claude", icon: pub("/images/svg/claude.svg") },
    { name: "Gemini", icon: pub("/images/svg/gemini.svg") },
    { name: "Copilot", icon: pub("/images/svg/copilot.svg") },
    { name: "Grok", icon: pub("/images/svg/grok.svg") },
    { name: "DeepSeek", icon: pub("/images/svg/deepseek.svg") },
];

const ease = [0.12, 0.23, 0.5, 1] as const;

const HERO_BACKGROUND_VIDEO = pub("/images/planeta.mp4");

export default function Hero() {
    return (
        <section className="relative flex flex-col bg-black-100 pt-[100px] md:pt-[160px] pb-8 md:pb-10" style={{ gap: "25px" }}>
            {/* ── Video container — fondo local (capa 0 + overlays) ── */}
            <div
                className="absolute top-0 left-0 right-0 overflow-hidden"
                style={{
                    height: "clamp(600px, 92vh, 980px)",
                    zIndex: 1,
                    background: "#000",
                    mask: "linear-gradient(#000 0% 85.6929%, #0000 100%)",
                    WebkitMask: "linear-gradient(#000 0% 85.6929%, #0000 100%)",
                }}
            >
                {/* Layer 0 — vídeo (filtros púrpura como diseño) */}
                <motion.video
                    src={HERO_BACKGROUND_VIDEO}
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload="auto"
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ zIndex: 0, filter: "grayscale(1) sepia(0.8) hue-rotate(230deg) saturate(1.6) brightness(0.75)" }}
                    initial={{ opacity: 0, y: 80, scale: 1.1 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 1.2, ease }}
                />
                {/* Layer 0b — purple tint overlay reinforcing Adray palette */}
                <div
                    className="absolute inset-0"
                    style={{
                        zIndex: 0,
                        background: "radial-gradient(ellipse at 50% 55%, rgba(202,138,229,0.25) 0%, rgba(62,40,111,0.35) 55%, rgba(16,12,18,0.6) 100%)",
                        mixBlendMode: "screen",
                    }}
                />
                {/* Layer 1 — Frost/glass overlay */}
                <motion.div
                    className="absolute inset-0"
                    style={{
                        zIndex: 1,
                        backdropFilter: "blur(10px)",
                        WebkitBackdropFilter: "blur(10px)",
                        background: "linear-gradient(180deg, rgba(255,254,250,0) 0%, rgba(255,255,255,0.07) 100%)",
                        mask: "radial-gradient(50% 50% at 47.9% 93.9%, transparent 69.1%, rgba(0,0,0,0.9) 81.8%, #000 100%)",
                        WebkitMask: "radial-gradient(50% 50% at 47.9% 93.9%, transparent 69.1%, rgba(0,0,0,0.9) 81.8%, #000 100%)",
                    }}
                    initial={{ opacity: 0, y: 80 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1.2, ease }}
                />
                {/* Layer 2 — Noise texture */}
                <div
                    className="absolute inset-0 noise-overlay"
                    style={{
                        opacity: 0.14,
                        zIndex: 1,
                        mask: "linear-gradient(rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.35) 15.3%, rgba(0,0,0,0.98) 31.6%, #000 100%)",
                        WebkitMask: "linear-gradient(rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.35) 15.3%, rgba(0,0,0,0.98) 31.6%, #000 100%)",
                    }}
                />
            </div>

            {/* ── Main Content ── */}
            <div className="relative z-2 w-full max-w-[1200px] mx-auto px-5 md:px-10 gap-[60px] md:gap-[130px]" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                {/* Content block — 40px gap between children */}
                <div className="flex flex-col items-center text-center w-full gap-6 md:gap-10">
                    {/* Badge — 10px gap to heading group */}
                    <div className="flex flex-col items-center" style={{ gap: "10px" }}>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.6, ease }}
                        >
                            <Badge className="text-white-100">Marketing intelligence for the generative era.</Badge>
                        </motion.div>

                        {/* Heading group — 24px gap between title/subtitle */}
                        <div className="flex flex-col items-center" style={{ gap: "24px" }}>
                            {/* H1 — outer container animates scale */}
                            <motion.div
                                initial={{ opacity: 0, y: 80, scale: 0.9 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ duration: 0.8, delay: 0.1, ease }}
                            >
                                <h1 className="t-h1 text-white-100 text-center max-w-[900px] text-[clamp(1.9rem,4.6vw,3.7rem)]">
                                    <BlurRevealText text="The first marketing data system built for AI" startDelay={0.15} />
                                </h1>
                            </motion.div>

                            {/* Subtitle — white, weight 500, blur reveal, text-shadow */}
                            <div className="t-p-lg-medium text-white-100 tracking-[-0.03em] text-center max-w-[640px] px-2" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.32)" }}>
                                <BlurRevealText
                                    text="Your full marketing stack: Meta, Google, GA4 reconciled, AI-ready, delivered every day for any AI you already use."
                                    startDelay={0.4}
                                />
                            </div>
                        </div>
                    </div>

                    {/* CTA Button */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.7, delay: 0.5, ease }}
                        className="flex flex-col items-center gap-4"
                    >
                        <Button variant="primary" size="lg" href="/login">
                            Get Started Free
                        </Button>
                        <p className="t-p-sm text-white-70">Free forever · No credit card · Works on any website · Now live</p>
                        <a href="#how-it-works">
                            <Badge className="text-white-70 hover:text-white-100 transition-colors cursor-pointer">
                                See How It Works ↓
                            </Badge>
                        </a>
                    </motion.div>
                </div>

                {/* Dashboard — with bottom fade mask, no border/radius */}
                <motion.div
                    className="w-full"
                    style={{
                        padding: "0 0 40px",
                        mask: "linear-gradient(#000 0%, rgba(0,0,0,0.44) 76.5%, transparent 100%)",
                        WebkitMask: "linear-gradient(#000 0%, rgba(0,0,0,0.44) 76.5%, transparent 100%)",
                    }}
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.6, ease }}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={pub("/images/adray-dashboard-hero.png")}
                        alt="Adray Dashboard"
                        className="w-full h-auto"
                        style={{ aspectRatio: "1.6036" }}
                    />
                </motion.div>
            </div>

            {/* ── Logo Marquee ── */}
            <div className="relative z-2 pb-4 overflow-hidden" style={{ padding: "0 40px 40px" }}>
                <div
                    className="relative"
                    style={{
                        maskImage: "linear-gradient(to right, transparent 0%, black 20%, black 80%, transparent 100%)",
                        WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 20%, black 80%, transparent 100%)",
                    }}
                >
                    <div className="flex items-center gap-[74px] animate-marquee">
                        {[...partnerLogos, ...partnerLogos].map((logo, i) => (
                            <div key={i} className="shrink-0 flex items-center gap-3 opacity-40 hover:opacity-60 transition-opacity">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={logo.icon}
                                    alt={logo.name}
                                    className="w-6 h-6 object-contain"
                                    style={{ filter: "brightness(0) invert(1)" }}
                                />
                                <span className="text-white-90 text-sm font-semibold tracking-wide whitespace-nowrap" style={{ fontFamily: "var(--font-brand)" }}>
                                    {logo.name}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
