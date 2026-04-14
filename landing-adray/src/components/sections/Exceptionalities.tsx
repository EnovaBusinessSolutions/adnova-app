"use client";

import React from "react";
import Container from "@/components/ui/Container";
import SectionHeading from "@/components/ui/SectionHeading";
import Card from "@/components/ui/Card";
import { pub } from "@/lib/paths";
import Button from "@/components/ui/Button";
import AnimatedSection from "@/components/ui/AnimatedSection";
import { brandify } from "@/lib/utils";

const cards = [
    {
        title: "AI-Native by Design",
        description:
            "No dashboard. Your AI chat is the interface. Ask questions in plain language, get answers backed by precomputed, reconciled data.",
        bgImage:
            "https://framerusercontent.com/images/AroYsG98cecxdfVar1RpE3QmpjY.webp",
    },
    {
        title: "Works on Any Website",
        description:
            "Shopify, WooCommerce, custom builds, B2B. If you\u2019re running digital ads, Adray works for you.",
        bgImage:
            "https://framerusercontent.com/images/yW0YwfEjj3XVmK9OpcRWpCha3k.png",
    },
    {
        title: "Portable Everywhere",
        description:
            "One Signal PDF. Works in any AI \u2014 Claude, ChatGPT, Gemini, Grok, Manus, Copilot, Perplexity \u2014 wherever you already work. Refreshed automatically every day.",
        bgImage:
            "https://framerusercontent.com/images/UoZeXgrLVIo07yWMmdM4MO8F0.webp",
    },
    {
        title: "Instant Value",
        description:
            "Your Signal starts building the moment your first platform connects. You don\u2019t need a complete stack to get started.",
        bgImage:
            "https://framerusercontent.com/images/TdhDQYxz25yRgOwLKeC05FZVk.webp",
    },
];

export default function Exceptionalities() {
    return (
        <section className="py-20 relative">
            <Container>
                <AnimatedSection>
                    <SectionHeading
                        tag="FEATURES"
                        tagIcon={
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={pub("/images/svg/BZk5mbe8FBf9Lhl8okYcCei2g.svg")}
                                alt=""
                                width={24}
                                height={24}
                            />
                        }
                        title="Built different. From the data layer up."
                        subtitle=""
                        titleClassName="text-white-100"
                    />
                </AnimatedSection>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {cards.map((card, i) => (
                        <AnimatedSection key={card.title} delay={i * 0.1}>
                            <Card className={`h-full relative overflow-hidden ${i === 0 ? "min-h-65" : "min-h-95"}`}>
                                {/* Background image */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={card.bgImage}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                                    style={i === 0 ? { filter: "brightness(1.33) sepia(1) hue-rotate(230deg) saturate(2)", opacity: 0.35 } : { filter: "sepia(1) hue-rotate(230deg) saturate(2)", opacity: 0.3 }}
                                />

                                {/* Speed card decorations */}
                                {i === 0 && (
                                    <>
                                        {/* SVG wireframe overlay */}
                                        <svg
                                            viewBox="0 0 578 462"
                                            fill="none"
                                            className="absolute inset-0 w-full h-full pointer-events-none"
                                            style={{ opacity: 0.5 }}
                                            preserveAspectRatio="none"
                                        >
                                            <path
                                                d="M 0 144 L 222 0 L 577.5 162.5 L 325.5 461.5 L 0 245 L 119 0 L 577.5 95.5 L 0 199 L 577.5 419 L 69.5 0 L 119 461.5 L 428 0 L 487.5 461.5"
                                                stroke="rgba(255,255,255,0.15)"
                                                strokeWidth="1"
                                            />
                                        </svg>
                                        {/* Animated gradient lines — rapid travel along wireframe axes */}
                                        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ containerType: "inline-size" }}>
                                            {[
                                                { top: 15, left: 5, rot: 12, travel: 60, dur: 1.8, delay: 0, color: "rgb(202,138,229)" },
                                                { top: 45, left: 10, rot: 82, travel: 48, dur: 2.1, delay: 0.3, color: "rgb(202,138,229)" },
                                                { top: 70, left: 25, rot: 147, travel: 55, dur: 1.5, delay: 0.7, color: "rgb(202,138,229)" },
                                                { top: 30, left: 55, rot: 39, travel: 52, dur: 2.4, delay: 1.1, color: "rgb(202,138,229)" },
                                                { top: 20, left: 40, rot: -9, travel: 66, dur: 1.6, delay: 0.5, color: "rgb(181,92,255)" },
                                                { top: 60, left: 15, rot: -97, travel: 43, dur: 2.0, delay: 0.9, color: "rgb(181,92,255)" },
                                                { top: 50, left: 65, rot: 26, travel: 59, dur: 1.9, delay: 0.2, color: "rgb(181,92,255)" },
                                                { top: 80, left: 45, rot: -56, travel: 50, dur: 2.2, delay: 1.4, color: "rgb(181,92,255)" },
                                            ].map((line, li) => (
                                                <div
                                                    key={li}
                                                    className="absolute"
                                                    style={{
                                                        top: `${line.top}%`,
                                                        left: `${line.left}%`,
                                                        transform: `rotate(${line.rot}deg)`,
                                                        transformOrigin: "0% 50%",
                                                    }}
                                                >
                                                    {/* Traveling dot */}
                                                    <div
                                                        style={{
                                                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                            ["--travel" as string]: `${line.travel}cqi`,
                                                            animation: `speed-line-travel ${line.dur}s linear ${line.delay}s infinite`,
                                                        } as React.CSSProperties}
                                                    >
                                                        {/* Blur layer */}
                                                        <div
                                                            style={{
                                                                width: "0.875em",
                                                                height: "0.125em",
                                                                background: `linear-gradient(90deg, ${line.color} 0%, rgb(255,255,255) 100%)`,
                                                                filter: "blur(0.125em)",
                                                                borderRadius: 999,
                                                            }}
                                                        />
                                                        {/* Sharp gradient layer */}
                                                        <div
                                                            style={{
                                                                width: "0.875em",
                                                                height: "0.125em",
                                                                background: `linear-gradient(90deg, ${line.color} 0%, rgb(255,255,255) 100%)`,
                                                                borderRadius: 999,
                                                                position: "absolute",
                                                                top: 0,
                                                                left: 0,
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}

                                {/* Slider animation — "Works on Any Website" card */}
                                {i === 1 && (
                                    <div
                                        className="absolute inset-x-0 bottom-0 flex items-end justify-center pointer-events-none"
                                        style={{ zIndex: 1, top: "38%", paddingBottom: "8%" }}
                                    >
                                        <div
                                            className="flex items-stretch justify-center"
                                            style={{ height: "100%", gap: "clamp(1.25rem, 8%, 3rem)" }}
                                        >
                                            {[
                                                { from: 6, to: 75, dur: 3.8, delay: 0 },
                                                { from: 60, to: 8, dur: 4.2, delay: 0.6 },
                                                { from: 4, to: 68, dur: 3.4, delay: 1.2 },
                                            ].map((bar, bi) => (
                                                <div
                                                    key={bi}
                                                    className="relative"
                                                    style={{ width: "clamp(1.125rem, 4.5%, 1.75rem)", height: "100%" }}
                                                >
                                                    {/* Outer track — glass pill */}
                                                    <div
                                                        style={{
                                                            position: "absolute",
                                                            inset: 0,
                                                            borderRadius: 999,
                                                            border: "0.0625rem solid rgba(255,255,255,0.1)",
                                                            background: "rgba(255,255,255,0.07)",
                                                            backdropFilter: "blur(0.25rem)",
                                                        }}
                                                    />
                                                    {/* Inner fill bar */}
                                                    <div
                                                        style={{
                                                            position: "absolute",
                                                            left: "16%",
                                                            right: "16%",
                                                            top: "3%",
                                                            bottom: "3%",
                                                            borderRadius: 999,
                                                            background: "rgba(255,255,255,0.25)",
                                                            boxShadow: "inset 0 0 0.375rem rgba(0,0,0,0.2)",
                                                        }}
                                                    >
                                                        {/* White center line */}
                                                        <div
                                                            style={{
                                                                position: "absolute",
                                                                left: "22%",
                                                                right: "22%",
                                                                top: 0,
                                                                bottom: 0,
                                                                borderRadius: 999,
                                                                background: "white",
                                                            }}
                                                        />
                                                    </div>
                                                    {/* Sliding dot */}
                                                    <div
                                                        style={{
                                                            position: "absolute",
                                                            left: "50%",
                                                            transform: "translateX(-50%)",
                                                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                            ["--dot-from" as string]: `${bar.from}%`,
                                                            ["--dot-to" as string]: `${bar.to}%`,
                                                            animation: `slider-dot ${bar.dur}s cubic-bezier(0.45, 0, 0.55, 1) ${bar.delay}s infinite alternate`,
                                                        } as React.CSSProperties}
                                                    >
                                                        {/* White core */}
                                                        <div
                                                            style={{
                                                                width: "0.875em",
                                                                height: "0.875em",
                                                                borderRadius: 999,
                                                                background: "white",
                                                                position: "relative",
                                                                zIndex: 2,
                                                                boxShadow: "0 0 0.25rem rgba(255,255,255,0.6)",
                                                            }}
                                                        />
                                                        {/* Purple glow halo */}
                                                        <div
                                                            style={{
                                                                width: "2.25em",
                                                                height: "2.25em",
                                                                borderRadius: 999,
                                                                background: "radial-gradient(circle, rgba(181,92,255,0.9) 0%, rgba(202,138,229,0.4) 60%, transparent 100%)",
                                                                filter: "blur(0.25rem)",
                                                                position: "absolute",
                                                                top: "50%",
                                                                left: "50%",
                                                                transform: "translate(-50%, -50%)",
                                                                zIndex: 1,
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Signal broadcast animation — "Portable Everywhere" card */}
                                {i === 2 && (
                                    <div
                                        className="absolute inset-x-0 bottom-0 pointer-events-none"
                                        style={{ zIndex: 1, top: "35%", display: "flex", justifyContent: "center", alignItems: "center" }}
                                    >
                                        {/* Square container for true circles */}
                                        <div style={{ position: "relative", width: "min(15rem, 55%)", aspectRatio: "1 / 1" }}>
                                            {/* Static orbit rings — always visible */}
                                            {[32, 52, 72].map((pct, ri) => (
                                                <div
                                                    key={ri}
                                                    style={{
                                                        position: "absolute",
                                                        top: "50%",
                                                        left: "50%",
                                                        width: `${pct * 2}%`,
                                                        height: `${pct * 2}%`,
                                                        marginLeft: `${-pct}%`,
                                                        marginTop: `${-pct}%`,
                                                        borderRadius: "50%",
                                                        border: "0.0625rem solid rgba(181,92,255,0.15)",
                                                    }}
                                                />
                                            ))}
                                            {/* Pulsing rings — radar sweep */}
                                            {[0, 1, 2].map((pi) => (
                                                <div
                                                    key={`p${pi}`}
                                                    style={{
                                                        position: "absolute",
                                                        inset: "-10%",
                                                        borderRadius: "50%",
                                                        border: "0.1rem solid rgba(202,138,229,0.35)",
                                                        animation: `signal-pulse 3s ease-out ${pi * 1}s infinite`,
                                                    }}
                                                />
                                            ))}
                                            {/* Central beacon */}
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    top: "50%",
                                                    left: "50%",
                                                    width: "1.125em",
                                                    height: "1.125em",
                                                    marginLeft: "-0.5625em",
                                                    marginTop: "-0.5625em",
                                                    borderRadius: "50%",
                                                    background: "white",
                                                    zIndex: 4,
                                                    animation: "beacon-glow 2.5s ease-in-out infinite",
                                                }}
                                            />
                                            {/* Orbiting AI dots */}
                                            {[
                                                { ring: 32, dur: 10, start: 0, label: "Claude" },
                                                { ring: 32, dur: 10, start: 120, label: "ChatGPT" },
                                                { ring: 32, dur: 10, start: 240, label: "Gemini" },
                                                { ring: 52, dur: 15, start: 30, label: "Grok" },
                                                { ring: 52, dur: 15, start: 150, label: "Copilot" },
                                                { ring: 52, dur: 15, start: 270, label: "Manus" },
                                                { ring: 72, dur: 20, start: 60, label: "Perplexity" },
                                            ].map((dot, di) => (
                                                <div
                                                    key={di}
                                                    style={{
                                                        position: "absolute",
                                                        top: "50%",
                                                        left: "50%",
                                                        width: `${dot.ring * 2}%`,
                                                        height: `${dot.ring * 2}%`,
                                                        marginLeft: `${-dot.ring}%`,
                                                        marginTop: `${-dot.ring}%`,
                                                        borderRadius: "50%",
                                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                        ["--orbit-start" as string]: `${dot.start}deg`,
                                                        animation: `orbit-spin ${dot.dur}s linear infinite`,
                                                    } as React.CSSProperties}
                                                >
                                                    {/* Dot positioned at top of its orbit */}
                                                    <div
                                                        style={{
                                                            position: "absolute",
                                                            top: 0,
                                                            left: "50%",
                                                            transform: "translate(-50%, -50%)",
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                width: "0.625em",
                                                                height: "0.625em",
                                                                borderRadius: "50%",
                                                                background: "white",
                                                                boxShadow: "0 0 0.375rem rgba(181,92,255,0.7), 0 0 0.875rem rgba(202,138,229,0.4)",
                                                            }}
                                                        />
                                                        {/* Label */}
                                                        <span
                                                            style={{
                                                                position: "absolute",
                                                                top: "100%",
                                                                left: "50%",
                                                                transform: "translateX(-50%)",
                                                                marginTop: "0.3em",
                                                                fontSize: "0.6875rem",
                                                                fontWeight: 600,
                                                                color: "rgba(255,255,255,0.75)",
                                                                whiteSpace: "nowrap",
                                                                letterSpacing: "0.02em",
                                                                textShadow: "0 0 0.5rem rgba(181,92,255,0.4)",
                                                            }}
                                                        >
                                                            {dot.label}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Plug-in + Tesla Lightning — "Instant Value" card */}
                                {i === 3 && (
                                    <div
                                        className="absolute inset-x-0 bottom-0 pointer-events-none"
                                        style={{ zIndex: 1, top: "24%", padding: "0 6% 6%", display: "flex", alignItems: "center", justifyContent: "flex-start" }}
                                    >
                                        <div style={{ position: "relative", width: "100%", height: "70%", display: "flex", alignItems: "center" }}>

                                            {/* === Cable from far left edge === */}
                                            <div style={{
                                                position: "absolute",
                                                left: 0,
                                                top: "50%",
                                                width: "30%",
                                                height: "0.12em",
                                                background: "linear-gradient(90deg, rgba(202,138,229,0.08), rgba(202,138,229,0.45))",
                                                borderRadius: 999,
                                                transform: "translateY(-50%)",
                                                animation: "cable-glow 4s ease-in-out infinite",
                                            }} />

                                            {/* === Plug — snaps into socket === */}
                                            <div style={{
                                                position: "absolute",
                                                left: "27%",
                                                top: "50%",
                                                transform: "translateY(-50%)",
                                                animation: "plug-snap 4s cubic-bezier(0.34, 1.56, 0.64, 1) infinite",
                                                display: "flex",
                                                alignItems: "center",
                                            }}>
                                                {/* Plug body */}
                                                <div style={{
                                                    width: "1.3em",
                                                    height: "2.4em",
                                                    borderRadius: "0.3em",
                                                    background: "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06))",
                                                    border: "0.06em solid rgba(255,255,255,0.2)",
                                                    position: "relative",
                                                }}>
                                                    {/* Prongs */}
                                                    {[0, 1].map((pi) => (
                                                        <div key={pi} style={{
                                                            position: "absolute",
                                                            right: "-0.6em",
                                                            top: pi === 0 ? "0.45em" : undefined,
                                                            bottom: pi === 1 ? "0.45em" : undefined,
                                                            width: "0.6em",
                                                            height: "0.22em",
                                                            borderRadius: "0.06em",
                                                            background: "linear-gradient(90deg, rgba(255,255,255,0.5), rgba(255,255,255,0.85))",
                                                        }} />
                                                    ))}
                                                </div>
                                            </div>

                                            {/* === Socket === */}
                                            <div style={{
                                                position: "absolute",
                                                left: "30%",
                                                top: "50%",
                                                transform: "translateY(-50%)",
                                                width: "2.6em",
                                                height: "3.4em",
                                                borderRadius: "0.5em",
                                                border: "0.1em solid rgba(255,255,255,0.15)",
                                                background: "rgba(255,255,255,0.04)",
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: "0.4em",
                                                zIndex: 2,
                                            }}>
                                                {[0, 1].map((si) => (
                                                    <div key={si} style={{
                                                        width: "0.5em",
                                                        height: "0.9em",
                                                        borderRadius: "0.25em",
                                                        background: "rgba(255,255,255,0.08)",
                                                        border: "0.06em solid rgba(255,255,255,0.12)",
                                                    }} />
                                                ))}
                                                {/* Socket glow on connect */}
                                                <div style={{
                                                    position: "absolute",
                                                    inset: "-0.6em",
                                                    borderRadius: "0.8em",
                                                    background: "radial-gradient(circle, rgba(181,92,255,0.6) 0%, transparent 70%)",
                                                    filter: "blur(0.5rem)",
                                                    animation: "socket-glow 4s ease-in-out infinite",
                                                }} />
                                            </div>

                                            {/* === Branching Tesla Lightning — SVG arcs erupting from socket === */}
                                            <svg
                                                viewBox="0 0 400 200"
                                                preserveAspectRatio="none"
                                                style={{
                                                    position: "absolute",
                                                    left: "34%",
                                                    top: "5%",
                                                    width: "66%",
                                                    height: "90%",
                                                    overflow: "visible",
                                                }}
                                            >
                                                <defs>
                                                    <linearGradient id="arc-grad-1" x1="0" y1="0.5" x2="1" y2="0.5">
                                                        <stop offset="0%" stopColor="rgb(255,255,255)" stopOpacity="0.95" />
                                                        <stop offset="50%" stopColor="rgb(202,138,229)" stopOpacity="0.8" />
                                                        <stop offset="100%" stopColor="rgb(181,92,255)" stopOpacity="0.3" />
                                                    </linearGradient>
                                                    <filter id="arc-blur">
                                                        <feGaussianBlur stdDeviation="2.5" />
                                                    </filter>
                                                </defs>

                                                {/* Main trunk arc */}
                                                <path
                                                    d="M0,100 L30,95 L55,108 L80,92 L110,104 L140,88 L170,100 L200,94 L235,102 L270,90 L300,98 L330,86 L360,100 L390,92"
                                                    fill="none"
                                                    stroke="url(#arc-grad-1)"
                                                    strokeWidth="2.2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    filter="url(#arc-blur)"
                                                    style={{
                                                        strokeDasharray: 800,
                                                        strokeDashoffset: 800,
                                                        animation: "tesla-arc 4s ease-out infinite",
                                                    }}
                                                />
                                                {/* Main trunk sharp overlay */}
                                                <path
                                                    d="M0,100 L30,95 L55,108 L80,92 L110,104 L140,88 L170,100 L200,94 L235,102 L270,90 L300,98 L330,86 L360,100 L390,92"
                                                    fill="none"
                                                    stroke="rgba(255,255,255,0.9)"
                                                    strokeWidth="1"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    style={{
                                                        strokeDasharray: 800,
                                                        strokeDashoffset: 800,
                                                        animation: "tesla-arc 4s ease-out infinite",
                                                    }}
                                                />

                                                {/* Branch 1 — upward fork */}
                                                <path
                                                    d="M110,104 L130,78 L155,65 L180,52 L210,40 L240,32"
                                                    fill="none"
                                                    stroke="url(#arc-grad-1)"
                                                    strokeWidth="1.6"
                                                    strokeLinecap="round"
                                                    filter="url(#arc-blur)"
                                                    style={{
                                                        strokeDasharray: 300,
                                                        strokeDashoffset: 300,
                                                        animation: "tesla-branch 4s ease-out 0.15s infinite",
                                                    }}
                                                />
                                                <path
                                                    d="M110,104 L130,78 L155,65 L180,52 L210,40 L240,32"
                                                    fill="none"
                                                    stroke="rgba(255,255,255,0.7)"
                                                    strokeWidth="0.7"
                                                    strokeLinecap="round"
                                                    style={{
                                                        strokeDasharray: 300,
                                                        strokeDashoffset: 300,
                                                        animation: "tesla-branch 4s ease-out 0.15s infinite",
                                                    }}
                                                />

                                                {/* Branch 2 — downward fork */}
                                                <path
                                                    d="M140,88 L160,120 L185,140 L215,155 L250,162"
                                                    fill="none"
                                                    stroke="url(#arc-grad-1)"
                                                    strokeWidth="1.6"
                                                    strokeLinecap="round"
                                                    filter="url(#arc-blur)"
                                                    style={{
                                                        strokeDasharray: 300,
                                                        strokeDashoffset: 300,
                                                        animation: "tesla-branch 4s ease-out 0.2s infinite",
                                                    }}
                                                />
                                                <path
                                                    d="M140,88 L160,120 L185,140 L215,155 L250,162"
                                                    fill="none"
                                                    stroke="rgba(255,255,255,0.7)"
                                                    strokeWidth="0.7"
                                                    strokeLinecap="round"
                                                    style={{
                                                        strokeDasharray: 300,
                                                        strokeDashoffset: 300,
                                                        animation: "tesla-branch 4s ease-out 0.2s infinite",
                                                    }}
                                                />

                                                {/* Branch 3 — upper sub-branch */}
                                                <path
                                                    d="M180,52 L200,35 L225,22 L255,18"
                                                    fill="none"
                                                    stroke="url(#arc-grad-1)"
                                                    strokeWidth="1.1"
                                                    strokeLinecap="round"
                                                    filter="url(#arc-blur)"
                                                    style={{
                                                        strokeDasharray: 200,
                                                        strokeDashoffset: 200,
                                                        animation: "tesla-branch 4s ease-out 0.3s infinite",
                                                    }}
                                                />

                                                {/* Branch 4 — lower sub-branch */}
                                                <path
                                                    d="M215,155 L240,170 L270,178 L300,175"
                                                    fill="none"
                                                    stroke="url(#arc-grad-1)"
                                                    strokeWidth="1.1"
                                                    strokeLinecap="round"
                                                    filter="url(#arc-blur)"
                                                    style={{
                                                        strokeDasharray: 200,
                                                        strokeDashoffset: 200,
                                                        animation: "tesla-branch 4s ease-out 0.35s infinite",
                                                    }}
                                                />

                                                {/* Branch 5 — mid upward tendril */}
                                                <path
                                                    d="M270,90 L290,65 L315,48 L340,42"
                                                    fill="none"
                                                    stroke="url(#arc-grad-1)"
                                                    strokeWidth="1.1"
                                                    strokeLinecap="round"
                                                    filter="url(#arc-blur)"
                                                    style={{
                                                        strokeDasharray: 200,
                                                        strokeDashoffset: 200,
                                                        animation: "tesla-branch 4s ease-out 0.25s infinite",
                                                    }}
                                                />

                                                {/* Branch 6 — mid downward tendril */}
                                                <path
                                                    d="M300,98 L320,128 L345,148 L375,155"
                                                    fill="none"
                                                    stroke="url(#arc-grad-1)"
                                                    strokeWidth="1.1"
                                                    strokeLinecap="round"
                                                    filter="url(#arc-blur)"
                                                    style={{
                                                        strokeDasharray: 200,
                                                        strokeDashoffset: 200,
                                                        animation: "tesla-branch 4s ease-out 0.32s infinite",
                                                    }}
                                                />

                                                {/* Tiny sub-forks for extra crackle */}
                                                {[
                                                    "M55,108 L65,125 L80,132",
                                                    "M200,94 L210,75 L225,68",
                                                    "M330,86 L345,70 L360,62",
                                                    "M235,102 L248,118 L265,125",
                                                ].map((d, ti) => (
                                                    <path
                                                        key={ti}
                                                        d={d}
                                                        fill="none"
                                                        stroke="rgba(202,138,229,0.5)"
                                                        strokeWidth="0.8"
                                                        strokeLinecap="round"
                                                        style={{
                                                            strokeDasharray: 100,
                                                            strokeDashoffset: 100,
                                                            animation: `tesla-branch 4s ease-out ${0.18 + ti * 0.08}s infinite`,
                                                        }}
                                                    />
                                                ))}
                                            </svg>

                                            {/* === Connection spark burst === */}
                                            {[0, 1, 2].map((ri) => (
                                                <div
                                                    key={ri}
                                                    style={{
                                                        position: "absolute",
                                                        left: "32%",
                                                        top: "50%",
                                                        transform: "translate(-50%, -50%)",
                                                        width: "2em",
                                                        height: "2em",
                                                        borderRadius: "50%",
                                                        border: "0.06em solid rgba(181,92,255,0.4)",
                                                        animation: `energy-ring 4s ease-out ${1.1 + ri * 0.15}s infinite`,
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Content */}
                                <div className="relative z-10">
                                    <h3 className="t-h4 text-white-100 mb-3">{card.title}</h3>
                                    <p className="t-p text-ad-muted">{brandify(card.description)}</p>
                                </div>
                            </Card>
                        </AnimatedSection>
                    ))}
                </div>

                {/* CTA Card */}
                <AnimatedSection delay={0.4}>
                    <Card className="mt-6 text-center py-12">
                        <h3 className="t-h4 text-white-100 mb-2">
                            Zero new tools to learn.
                        </h3>
                        <p className="t-p text-ad-muted mb-8">
                            No new UI. No weekly logins. No clunky integrations. Your AI does the work.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <Button variant="primary" href="/getstarted">
                                Get Started Free
                            </Button>
                            <Button variant="ghost" href="/contact">
                                Get in touch
                            </Button>
                        </div>
                    </Card>
                </AnimatedSection>
            </Container>
        </section>
    );
}
