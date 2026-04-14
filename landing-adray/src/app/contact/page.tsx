"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import Container from "@/components/ui/Container";
import SectionHeading from "@/components/ui/SectionHeading";
import AnimatedSection from "@/components/ui/AnimatedSection";
import Button from "@/components/ui/Button";
import BlurRevealText from "@/components/ui/BlurRevealText";
import { brandify } from "@/lib/utils";
import { pub } from "@/lib/paths";

const ease = [0.21, 0.47, 0.32, 0.98] as const;

export default function ContactPage() {
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
                        <img
                            src={pub("/images/svg/xDPyxO9KaHgkC204pqOjJmGbwk.svg")}
                            alt=""
                            width={24}
                            height={24}
                            className="opacity-80"
                        />
                        CONTACT
                    </motion.div>
                    <motion.h1
                        className="t-h1 text-white-90 mb-6"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.1, ease }}
                    >
                        <BlurRevealText text="Questions About Your Data?" startDelay={0.15} />
                    </motion.h1>
                    <motion.p
                        className="t-p-lg text-ad-subtitle max-w-2xl mx-auto"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.25, ease }}
                    >
                        Whether you need onboarding help, want to explore a partnership, or just have a question — we’re here.
                    </motion.p>
                </Container>
            </section>

            {/* ── Support Form ── */}
            <section className="py-20 relative">
                <Container>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10 max-w-5xl mx-auto mb-12">
                        <AnimatedSection>
                            <SectionHeading
                                tag="SUPPORT"
                                tagIcon={
                                    <img
                                        src={pub("/images/svg/ovrqK10uB6vuZpVvC1WLvsJNHFU.svg")}
                                        alt=""
                                        width={24}
                                        height={24}
                                    />
                                }
                                title="We're Here to Help"
                                subtitle="Need help with your pixel, data sync, or agent setup? Reach out via the form, phone, or email."
                                align="left"
                                className="mb-0"
                            />
                        </AnimatedSection>

                        <AnimatedSection delay={0.1}>
                            <div>
                                <p className="t-p-sm uppercase tracking-widest text-ad-tag mb-6">GET SUPPORT</p>
                                <div className="space-y-4">
                                    <a href="tel:+18449248973" className="flex items-center gap-4 group">
                                        <div className="relative shrink-0 w-[34px] h-[34px] rounded-xl bg-black overflow-hidden">
                                            <img
                                                src="https://framerusercontent.com/images/VZt72ssnuCqRvMzPSvHlDQ1iNU.png"
                                                alt=""
                                                className="absolute inset-0 w-full h-full object-cover"
                                            />
                                            <img
                                                src={pub("/images/svg/ZWTVawMwhcN0IIzbO291BWd5c.svg")}
                                                alt=""
                                                width={34}
                                                height={34}
                                                className="relative z-10"
                                            />
                                        </div>
                                        <span className="t-p text-white-90 group-hover:text-ad-primary transition-colors">+1 844 924 8973</span>
                                    </a>
                                    <a href="mailto:support@adray.com" className="flex items-center gap-4 group">
                                        <div className="relative shrink-0 w-[34px] h-[34px] rounded-xl bg-black overflow-hidden">
                                            <img
                                                src="https://framerusercontent.com/images/VZt72ssnuCqRvMzPSvHlDQ1iNU.png"
                                                alt=""
                                                className="absolute inset-0 w-full h-full object-cover"
                                            />
                                            <img
                                                src={pub("/images/svg/ochO9ePlZvXdFfWVus3LbO0Yw.svg")}
                                                alt=""
                                                width={34}
                                                height={34}
                                                className="relative z-10"
                                            />
                                        </div>
                                        <span className="t-p text-white-90 group-hover:text-ad-primary transition-colors">support@adray.com</span>
                                    </a>
                                </div>
                            </div>
                        </AnimatedSection>
                    </div>

                    <AnimatedSection delay={0.15}>
                        <form
                            className="card p-8 space-y-6 max-w-5xl mx-auto"
                            onSubmit={(e) => e.preventDefault()}
                        >
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div>
                                    <label className="block t-p-sm text-ad-muted mb-2">
                                        First Name
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full px-4 py-3 rounded-xl bg-ad-surface border border-ad-border text-white-100 t-p-sm placeholder:text-ad-muted/40 focus:outline-none focus:border-ad-primary transition-colors"
                                        placeholder="Jane"
                                    />
                                </div>
                                <div>
                                    <label className="block t-p-sm text-ad-muted mb-2">
                                        Last Name
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full px-4 py-3 rounded-xl bg-ad-surface border border-ad-border text-white-100 t-p-sm placeholder:text-ad-muted/40 focus:outline-none focus:border-ad-primary transition-colors"
                                        placeholder="Smith"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block t-p-sm text-ad-muted mb-2">
                                    Email
                                </label>
                                <input
                                    type="email"
                                    className="w-full px-4 py-3 rounded-xl bg-ad-surface border border-ad-border text-white-100 t-p-sm placeholder:text-ad-muted/40 focus:outline-none focus:border-ad-primary transition-colors"
                                    placeholder="jane@yourstore.com"
                                />
                            </div>
                            <div>
                                <label className="block t-p-sm text-ad-muted mb-2">
                                    Contact Number
                                </label>
                                <input
                                    type="tel"
                                    className="w-full px-4 py-3 rounded-xl bg-ad-surface border border-ad-border text-white-100 t-p-sm placeholder:text-ad-muted/40 focus:outline-none focus:border-ad-primary transition-colors"
                                    placeholder="+1234567890"
                                />
                            </div>
                            <div>
                                <label className="block t-p-sm text-ad-muted mb-2">
                                    Query
                                </label>
                                <textarea
                                    rows={4}
                                    className="w-full px-4 py-3 rounded-xl bg-ad-surface border border-ad-border text-white-100 t-p-sm placeholder:text-ad-muted/40 focus:outline-none focus:border-ad-primary transition-colors resize-none"
                                    placeholder="Share your query"
                                />
                            </div>
                            <Button variant="primary" size="lg" className="w-full">
                                Submit
                            </Button>
                        </form>
                    </AnimatedSection>
                </Container>
            </section>
        </>
    );
}
