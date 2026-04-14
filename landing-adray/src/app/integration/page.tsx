"use client";

import React from "react";
import { motion } from "framer-motion";
import Container from "@/components/ui/Container";
import AnimatedSection from "@/components/ui/AnimatedSection";
import BlurRevealText from "@/components/ui/BlurRevealText";

const categories = [
    {
        name: "Cloud Providers",
        logos: [
            "https://framerusercontent.com/images/JUvBGCysMSaCjL2aN82cRfVOMc.svg",
            "https://framerusercontent.com/images/TmKPLfQXwRi6lR29TNpB4mbq7Bc.svg",
            "https://framerusercontent.com/images/OcOiLWF4dKJLx2SBVCamEI6LdCU.svg",
            "https://framerusercontent.com/images/UaomcxMK8cPD4SXxvL3HGfBRQ.svg",
            "https://framerusercontent.com/images/EFw2BnhGu1cDJNbRHw0d8fC0qI.svg",
            "https://framerusercontent.com/images/WMr3lTXrJTQ8BNmqCU4JGN4Oow.svg",
            "https://framerusercontent.com/images/JUvBGCysMSaCjL2aN82cRfVOMc.svg",
        ],
    },
    {
        name: "AI Models",
        logos: [
            "https://framerusercontent.com/images/L8lJ305fy3AQefD2drYt4J1Gv4.svg",
            "https://framerusercontent.com/images/3D1x14cKz9oVMbQNJKfQYb3x1hw.svg",
            "https://framerusercontent.com/images/y34h9OAREzDvfzPCEJ6c8CUyFE.svg",
            "https://framerusercontent.com/images/AYyiJdDBaT1kYJuaXlRfmEwQNI.svg",
            "https://framerusercontent.com/images/L4UQk6R4KQRB6wlGz9mknfS7jIQ.svg",
            "https://framerusercontent.com/images/cxL2LOaVNMOWHbH8g7u9lqx1E.svg",
            "https://framerusercontent.com/images/L8lJ305fy3AQefD2drYt4J1Gv4.svg",
        ],
    },
    {
        name: "CRM",
        logos: [
            "https://framerusercontent.com/images/FnR5oNUYxv1w7Hn4raTSofqf4PQ.svg",
            "https://framerusercontent.com/images/6AaSJiIySSWFnZ2EwKMB7HFMnk.svg",
            "https://framerusercontent.com/images/0Ld7c3yl06jmKsKbpmJ4Hy8CQ.svg",
            "https://framerusercontent.com/images/RxnfUWHOBXLxkqQSnCJcuIJUF4.svg",
            "https://framerusercontent.com/images/m8K4RkZiUERYmYS54fblSBiLqjI.svg",
            "https://framerusercontent.com/images/rrlDZFaJ6CZSFxYpUeMGmcmU.svg",
            "https://framerusercontent.com/images/FnR5oNUYxv1w7Hn4raTSofqf4PQ.svg",
        ],
    },
    {
        name: "IT Service",
        logos: [
            "https://framerusercontent.com/images/6XSO5s8z5qNe5r9AXW1wh9ZmE.svg",
            "https://framerusercontent.com/images/lAbfG3L7J8pN43LLemHeFGfE.svg",
            "https://framerusercontent.com/images/TG3c8pPl4jVnTzLOhxoprJHA.svg",
            "https://framerusercontent.com/images/K3amzVPc3YJgYtEWLwjLjqnK4Y.svg",
            "https://framerusercontent.com/images/Zre3S9eTJEZPUNmWKC6Uf6Eno0.svg",
            "https://framerusercontent.com/images/VuPgHxN9uhdCJgAHB4FjEaknAwQ.svg",
            "https://framerusercontent.com/images/6XSO5s8z5qNe5r9AXW1wh9ZmE.svg",
        ],
    },
];

const ease = [0.21, 0.47, 0.32, 0.98] as const;

export default function IntegrationPage() {
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
                        INTEGRATION
                    </motion.div>
                    <motion.h1
                        className="t-h1 text-white-90 mb-6"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.1, ease }}
                    >
                        <BlurRevealText text="Freedom to choose your integrations" startDelay={0.15} />
                    </motion.h1>
                    <motion.p
                        className="t-p-lg text-ad-subtitle max-w-2xl mx-auto"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.25, ease }}
                    >
                        Connect any app or system to build a unified enterprise intelligence layer.
                    </motion.p>
                </Container>
            </section>

            {/* ── Integration Categories ── */}
            <section className="py-20 relative">
                <Container>
                    <div className="flex flex-col gap-16">
                        {categories.map((cat, ci) => (
                            <AnimatedSection key={cat.name} delay={ci * 0.1}>
                                <h3 className="t-h4 text-white-90 text-center mb-8">
                                    {cat.name}
                                </h3>
                                {/* Scrolling marquee row */}
                                <div className="relative overflow-hidden">
                                    <div className="flex gap-8 animate-marquee">
                                        {[...cat.logos, ...cat.logos].map((url, j) => (
                                            <div
                                                key={j}
                                                className="shrink-0 w-24 h-24 rounded-2xl bg-white-7 border border-ad-border flex items-center justify-center p-4"
                                            >
                                                <img
                                                    src={url}
                                                    alt=""
                                                    className="w-full h-full object-contain"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </AnimatedSection>
                        ))}
                    </div>
                </Container>
            </section>
        </>
    );
}
