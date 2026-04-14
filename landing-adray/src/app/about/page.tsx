"use client";

import React from "react";
import { motion } from "framer-motion";
import Container from "@/components/ui/Container";
import SectionHeading from "@/components/ui/SectionHeading";
import AnimatedSection from "@/components/ui/AnimatedSection";
import Button from "@/components/ui/Button";
import BlurRevealText from "@/components/ui/BlurRevealText";
import ScrollTextColor from "@/components/ui/ScrollTextColor";
import { brandify } from "@/lib/utils";
import { pub } from "@/lib/paths";

/* ── Data ── */
const values = [
    {
        title: "Own the Data, Not the Dashboard",
        description:
            "We believe the data layer is worth more than any UI built on top of it. We own collection and reconciliation — merchants choose the tools.",
        gradient: "https://framerusercontent.com/images/SEwIHyt9NYJZFvnl5EfirpMYVE.png",
    },
    {
        title: "Free at Scale Beats Paid with Better Features",
        description:
            "Our free tier scales to 100k merchants at near-zero cost. Every connected pixel strengthens the network for everyone.",
        gradient: "https://framerusercontent.com/images/Jecsu2g820ZvCsU3axIprDjA.png",
    },
    {
        title: "Invisible Infrastructure, Real Results",
        description:
            "The best outcome is a merchant who never thinks about us — they just know their AI gives accurate answers and their agents run reliably.",
        gradient: "https://framerusercontent.com/images/YeudDKQ2dKYEjVeYoqqOI1QRgY.png",
    },
];

const team = [
    { name: "Ethan Cole", role: "CEO", img: "https://framerusercontent.com/images/0RzulRwff33IEQYq44WadnRO9w.png" },
    { name: "Sofia Andersson", role: "CTO", img: "https://framerusercontent.com/images/pogDSBBcXE1ARRGZ4ymWiMN9k3s.png" },
    { name: "Liam Johnson", role: "Head of Design", img: "https://framerusercontent.com/images/zH9OJGqbKlLQPDJpmS5CTGnk3U.png" },
    { name: "Noah Fischer", role: "Lead AI Engineer", img: "https://framerusercontent.com/images/AFl7pP4fZDdOrB3xrVWc5X5Fq8.png" },
    { name: "Ava Mitchell", role: "Marketing", img: "https://framerusercontent.com/images/hcKl6XFv59NYLhRNg4S5hDt8Lpc.png" },
    { name: "Lucas Meyer", role: "Senior Developer", img: "https://framerusercontent.com/images/GLqOvHvSsnYGyLNRwMTRwaoSPI.png" },
    { name: "Benjamin Scott", role: "Backend Architect", img: "https://framerusercontent.com/images/IvWc2PsMQE78uKKsltwGy1fMBRY.png" },
    { name: "Oliver Novak", role: "Operations & Partnerships", img: "https://framerusercontent.com/images/Ls5ITWuivoY17COVCArif8vmQU.png" },
];

const ease = [0.21, 0.47, 0.32, 0.98] as const;

export default function AboutPage() {
    return (
        <>
            {/* ── Hero ── */}
            <section className="relative pt-40 pb-20 overflow-hidden">
                {/* Gradient bg */}
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        backgroundImage:
                            "url(https://framerusercontent.com/images/H3Q7Up1GD9JyEYygvN5U7fWpqYQ.webp)",
                        backgroundSize: "cover",
                        backgroundPosition: "center top",
                        opacity: 0.5,
                        filter: "sepia(1) hue-rotate(230deg) saturate(2)",
                    }}
                />
                <Container className="relative z-10">
                    <div className="flex items-center gap-3 mb-6">
                        <img
                            src={pub("/images/svg/eWJcm0cKj3Rsxetaz4suNQKuW8o.svg")}
                            alt=""
                            width={24}
                            height={24}
                            className="opacity-80"
                        />
                        <span className="t-p-sm uppercase tracking-widest text-ad-tag">
                            ABOUT
                        </span>
                        <div className="tag-line" />
                    </div>

                    <motion.h1
                        className="t-h1 text-white-90 mb-6"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.1, ease }}
                    >
                        <BlurRevealText text="The Data Layer Behind Ecommerce" startDelay={0.15} />
                    </motion.h1>
                    <motion.p
                        className="t-p-lg text-ad-subtitle max-w-2xl mb-12"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.25, ease }}
                    >
                        We reconcile Meta, Google, and Shopify into one source of truth — so merchants finally know what&apos;s actually driving revenue.
                    </motion.p>

                    {/* Hero image */}
                    <motion.div
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.35, ease }}
                    >
                        <img
                            src="https://framerusercontent.com/images/QideC8FgAh77VffdlgsnsQ7AarU.png"
                            alt="Adray Dashboard"
                            className="w-full h-auto rounded-2xl"
                            style={{ aspectRatio: "3336/1577" }}
                        />
                    </motion.div>
                </Container>
            </section>

            {/* ── Mission scroll text ── */}
            <section className="py-20 relative">
                <Container className="max-w-4xl">
                    <ScrollTextColor
                        content="Every ad platform tells a different story. Merchants deserve a single source of truth. We built Adray to be the invisible data layer that reconciles it all — then hands it to the AI tools merchants already use."
                        colorStart="#B55CFF"
                        colorEnd="#E1D8F3"
                        trigger="layer-in-view"
                        animationStart="center"
                        animationEnd="bottom"
                        className="text-[clamp(1.25rem,2.5vw,1.75rem)] font-medium leading-relaxed text-center"
                        style={{ fontFamily: 'var(--font-display)' }}
                    />
                </Container>
            </section>

            {/* ── Our Values ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <SectionHeading
                            tag="OUR VALUES"
                            tagIcon={
                                <img
                                    src={pub("/images/svg/eS5b9sHb3EsbFgcgHgtjc8FZ1Y.svg")}
                                    alt=""
                                    width={24}
                                    height={24}
                                />
                            }
                            title="We are committed"
                            subtitle={brandify("The principles that guide how we build Adray.")}
                        />
                    </AnimatedSection>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {values.map((v, i) => (
                            <AnimatedSection key={v.title} delay={i * 0.12}>
                                <div className="card relative overflow-hidden h-full flex flex-col">
                                    <img
                                        src={v.gradient}
                                        alt=""
                                        className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                                        style={{ filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                                    />
                                    <div className="relative z-10 p-8 flex flex-col h-full">
                                        <h3 className="t-h4 text-white-90 mb-3">{v.title}</h3>
                                        <p className="t-p-sm text-ad-muted leading-relaxed mt-auto">
                                            {v.description}
                                        </p>
                                    </div>
                                </div>
                            </AnimatedSection>
                        ))}
                    </div>
                </Container>
            </section>

            {/* ── Our Founder ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <SectionHeading
                            tag="OUR FOUNDER"
                            tagIcon={
                                <img
                                    src={pub("/images/svg/JkTqK8jhgMOxUyl4OCizgeYU.svg")}
                                    alt=""
                                    width={24}
                                    height={24}
                                />
                            }
                            title="From the Founder"
                            subtitle="Why we pivoted from dashboard to data infrastructure."
                        />
                    </AnimatedSection>

                    <AnimatedSection delay={0.15}>
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-10 items-center">
                            <div className="rounded-3xl overflow-hidden">
                                <img
                                    src="https://framerusercontent.com/images/80PNQ5gECTFURxvZw2l9ozs7c.webp"
                                    alt="Founder"
                                    className="w-full h-auto object-cover"
                                    style={{ aspectRatio: "1202/1487" }}
                                />
                            </div>
                            <blockquote className="t-p-lg text-white-90 italic leading-relaxed">
                                &ldquo;We started building a dashboard — then realized the real
                                value was underneath it. Every ad platform tells merchants a
                                different story. Meta says 40x ROAS. Google says 8x. Shopify
                                shows 12 orders. Nobody knows what&apos;s real. We stopped
                                competing with AI interfaces and became the data layer they
                                depend on. Today, <span style={{ fontFamily: 'var(--font-brand)' }}>Adray</span> reconciles the truth across platforms
                                and hands it to the AI tools merchants already use. The best
                                infrastructure is invisible — and that&apos;s exactly what we&apos;re
                                building.&rdquo;
                            </blockquote>
                        </div>
                    </AnimatedSection>
                </Container>
            </section>

            {/* ── Meet the Team (Pillars) ── */}
            <section className="py-20 relative">
                {/* Background gradient */}
                <div
                    className="absolute inset-0 pointer-events-none opacity-30"
                    style={{
                        backgroundImage:
                            "url(https://framerusercontent.com/images/PEUUUxYckhxt8G82fn4Y0LPz5s.png)",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        filter: "sepia(1) hue-rotate(230deg) saturate(2)",
                    }}
                />
                <Container className="relative z-10">
                    <AnimatedSection>
                        <SectionHeading
                            tag="PILLARS"
                            tagIcon={
                                <img
                                    src={pub("/images/svg/QauTQfLJbX1ivAkVbcLLwuMoHQ.svg")}
                                    alt=""
                                    width={24}
                                    height={24}
                                />
                            }
                            title="Meet the <span style='font-family:var(--font-brand)'>Adray</span> Minds"
                            subtitle="A team of ecommerce data engineers, growth operators, and AI builders."
                        />
                    </AnimatedSection>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        {team.map((m, i) => (
                            <AnimatedSection key={m.name} delay={i * 0.08}>
                                <div className="group relative rounded-3xl overflow-hidden aspect-3/4">
                                    <img
                                        src={m.img}
                                        alt={m.name}
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 grayscale"
                                    />
                                    <div
                                        className="absolute inset-0"
                                        style={{
                                            background:
                                                "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 50%)",
                                        }}
                                    />
                                    <div className="absolute bottom-0 left-0 right-0 p-5">
                                        <p className="t-p-semibold text-white-90">{m.name}</p>
                                        <p className="t-p-sm text-ad-muted">{m.role}</p>
                                    </div>
                                </div>
                            </AnimatedSection>
                        ))}
                    </div>
                </Container>
            </section>

            {/* ── Join Us ── */}
            <section className="py-20 relative">
                <Container>
                    <AnimatedSection>
                        <SectionHeading
                            tag="JOIN US"
                            tagIcon={
                                <img
                                    src={pub("/images/svg/3UiRUIAjek5XnV6oCtR4F5HwgOU.svg")}
                                    alt=""
                                    width={24}
                                    height={24}
                                />
                            }
                            title="Join us as we build ecommerce&rsquo;s data layer."
                            subtitle="We&rsquo;re on a mission to connect 100k stores to the truth behind their ad spend. If you care about data infrastructure, ecommerce, and making AI actually useful — we want to hear from you."
                        />
                    </AnimatedSection>

                    <AnimatedSection delay={0.15}>
                        <div className="grid grid-cols-2 gap-4 mb-10">
                            {/* Left column */}
                            <div className="flex flex-col gap-4">
                                <div className="rounded-2xl overflow-hidden flex-5">
                                    <img
                                        src="https://framerusercontent.com/images/Jp1l6nfzIznnFpz8xA77dr6ShY.jpg"
                                        alt=""
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <div className="rounded-2xl overflow-hidden flex-1">
                                    <img
                                        src="https://framerusercontent.com/images/G2e7HlhrS4QOvLT8fLk72DmOr5A.webp"
                                        alt=""
                                        className="w-full h-full object-cover"
                                        style={{ filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                                    />
                                </div>
                            </div>
                            {/* Right column */}
                            <div className="flex flex-col gap-4">
                                <div className="rounded-2xl overflow-hidden flex-1">
                                    <img
                                        src="https://framerusercontent.com/images/oXO7T72nyamuKTgGVuI0pWw26Ns.webp"
                                        alt=""
                                        className="w-full h-full object-cover"
                                        style={{ filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                                    />
                                </div>
                                <div className="rounded-2xl overflow-hidden flex-5">
                                    <img
                                        src="https://framerusercontent.com/images/j31VAapLRCe7cdp82p8kZi7nBS8.png"
                                        alt=""
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="text-center">
                            <Button
                                variant="primary"
                                size="lg"
                                href="https://www.linkedin.com/jobs/"
                            >
                                Join Our Team
                            </Button>
                        </div>
                    </AnimatedSection>
                </Container>
            </section>
        </>
    );
}
