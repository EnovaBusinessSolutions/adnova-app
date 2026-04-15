"use client";

import React from "react";
import Link from "next/link";
import Container from "@/components/ui/Container";
import Button from "@/components/ui/Button";
import BlurRevealText from "@/components/ui/BlurRevealText";

const footerLinks = {
    Navigation: [
        { label: "How It Works", href: "/#how-it-works" },
        { label: "Pricing", href: "/pricing" },
        { label: "For Agencies", href: "/agencies" },
        { label: "Contact", href: "/contact" },
    ],
    Documentation: [
        { label: "Privacy Policy", href: "/privacy-policy" },
        { label: "Terms and Conditions", href: "/privacy-policy/terms-and-conditions" },
    ],
    "Social Connect": [
        { label: "X / Twitter", href: "https://x.com/adray_ai" },
    ],
};

export default function Footer() {
    return (
        <footer className="relative overflow-hidden">
            {/* CTA Section */}
            <div className="relative py-32 md:py-40">
                {/* Background image */}
                <div
                    className="absolute inset-0 opacity-40"
                    style={{
                        backgroundImage:
                            "url(https://framerusercontent.com/images/3ez5Goty6KdEzujpWDVyu8Um6Ns.webp)",
                        backgroundSize: "cover",
                        backgroundPosition: "center top",
                        maskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
                        WebkitMaskImage:
                            "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
                        filter: "sepia(1) hue-rotate(230deg) saturate(2)",
                    }}
                />

                <Container className="relative z-10 text-center">
                    <div>
                        <h2 className="t-h2 text-white-100 mb-6">
                            <BlurRevealText text="Your AI is ready." triggerOnScroll startDelay={0} />
                            <br />
                            <BlurRevealText text="Give it something real to work with." triggerOnScroll startDelay={0.4} />
                        </h2>
                        <p className="t-p-lg text-ad-muted max-w-xl mx-auto mb-10">
                            Install free. Connect in 2 minutes. Start getting answers.
                        </p>
                        <div className="flex items-center justify-center">
                            <Button variant="primary" size="lg" href="/login">
                                Get Started Free
                            </Button>
                        </div>
                        <p className="mt-4 t-p-sm text-ad-muted">
                            Free forever &middot; No credit card &middot; Works on any website
                        </p>
                    </div>

                    {/* Large wordmark display */}
                    <div className="mt-20 flex items-center justify-center gap-8" style={{ mixBlendMode: "difference" }}>
                        <span
                            className="text-[32px] md:text-[40px] font-bold tracking-[-0.02em] text-white-90 opacity-20 select-none"
                            style={{ fontFamily: 'var(--font-brand)' }}
                        >
                            Adray
                        </span>
                        <span
                            className="text-[48px] md:text-[64px] font-bold tracking-[-0.02em] text-white-90 select-none"
                            style={{ fontFamily: 'var(--font-brand)' }}
                        >
                            Adray
                        </span>
                        <span
                            className="text-[32px] md:text-[40px] font-bold tracking-[-0.02em] text-white-90 opacity-20 select-none"
                            style={{ fontFamily: 'var(--font-brand)' }}
                        >
                            Adray
                        </span>
                    </div>
                </Container>
            </div>

            {/* Footer Links */}
            <div className="border-t border-ad-border">
                <Container className="py-12">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                        {Object.entries(footerLinks).map(([title, links]) => (
                            <div key={title}>
                                <h4 className="t-p-semibold text-white-90 mb-4">{title}</h4>
                                <ul className="space-y-3">
                                    {links.map((link) => (
                                        <li key={link.label}>
                                            <Link
                                                href={link.href}
                                                className="t-p-sm text-ad-muted hover:text-white-100 transition-colors duration-200"
                                                {...(link.href.startsWith("http")
                                                    ? { target: "_blank", rel: "noopener noreferrer" }
                                                    : {})}
                                            >
                                                {link.label}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>

                    {/* Bottom bar */}
                    <div className="mt-12 pt-8 border-t border-ad-border flex items-center justify-center">
                        <p className="t-p-sm text-ad-muted">
                            Marketing intelligence for the generative era. &middot; All rights reserved.
                        </p>
                    </div>
                </Container>
            </div>
        </footer>
    );
}
