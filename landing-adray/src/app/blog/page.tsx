"use client";

import React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import Container from "@/components/ui/Container";
import AnimatedSection from "@/components/ui/AnimatedSection";
import BlurRevealText from "@/components/ui/BlurRevealText";
import { pub } from "@/lib/paths";

const blogs = [
    {
        title: "Breaking Down Data Silos: Unlocking True Business Potential",
        date: "Mar 4, 2025",
        slug: "breaking-down-data-silos-unlocking-true-business-potential",
        image: "https://framerusercontent.com/images/j5qTKLjJztSbNI7CNx1yBnVeTg.png",
        featured: true,
    },
    {
        title: "Revolutionizing Data Intelligence: A New Era in Business Insight",
        date: "Mar 9, 2025",
        slug: "revolutionizing-data-intelligence-a-new-era-in-business-insight",
        image: "https://framerusercontent.com/images/QomjkXg3gg6rKy2NPac6PJaPdgI.png",
    },
    {
        title: "Real-Time Data Tracking: Driving Immediate Business Impact",
        date: "Mar 20, 2025",
        slug: "real-time-data-tracking-driving-immediate-business-impact",
        image: "https://framerusercontent.com/images/8zl7vpvsE1HJX4aUQrkqc4Uong.png",
    },
    {
        title: "Breaking Down Data Silos: Unlocking True Business Potential",
        date: "Mar 4, 2025",
        slug: "breaking-down-data-silos-unlocking-true-business-potential",
        image: "https://framerusercontent.com/images/j5qTKLjJztSbNI7CNx1yBnVeTg.png",
    },
    {
        title: "Predictive Analytics: Staying Ahead of Market Trends",
        date: "Mar 14, 2025",
        slug: "predictive-analytics-staying-ahead-of-market-trends",
        image: "https://framerusercontent.com/images/eoun6TSlzgiGrR2ymIUIMLB16I.png",
    },
    {
        title: "Smarter Decisions with Automated Data Insights",
        date: "Mar 12, 2025",
        slug: "smarter-decisions-with-automated-data-insights",
        image: "https://framerusercontent.com/images/VtSULQ70AOr8JCh1UG0dIza7qM.png",
    },
];

const ease = [0.21, 0.47, 0.32, 0.98] as const;

export default function BlogPage() {
    const featured = blogs[0];
    const grid = blogs.slice(1);

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
                            src={pub("/images/svg/Hviy65FJn8RtNZbKss87zkB2E.svg")}
                            alt=""
                            width={24}
                            height={24}
                            className="opacity-80"
                        />
                        BLOGS
                    </motion.div>
                    <motion.h1
                        className="t-h1 text-white-90 mb-6"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.1, ease }}
                    >
                        <BlurRevealText text="AI Innovation and technology share" startDelay={0.15} />
                    </motion.h1>
                    <motion.p
                        className="t-p-lg text-ad-subtitle max-w-2xl mx-auto"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.25, ease }}
                    >
                        Explore in-depth insights, ideas, and industry updates.
                    </motion.p>
                </Container>
            </section>

            {/* ── Hero bg gradient ── */}
            <div className="absolute inset-x-0 top-0 overflow-hidden pointer-events-none" style={{ height: "100%" }}>
                <img
                    src="https://framerusercontent.com/images/H3Q7Up1GD9JyEYygvN5U7fWpqYQ.webp"
                    alt=""
                    className="w-full object-cover"
                    style={{ marginTop: "-40px", maskImage: "linear-gradient(#000 0% 66.98%, transparent 100%)", WebkitMaskImage: "linear-gradient(#000 0% 66.98%, transparent 100%)", filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                />
            </div>

            {/* ── Featured Post ── */}
            <section className="pb-12 relative">
                <Container>
                    <AnimatedSection>
                        <Link href={`/blog/${featured.slug}`} className="block group">
                            <div className="card overflow-hidden rounded-3xl">
                                <div className="relative aspect-[2.2/1] overflow-hidden">
                                    <img
                                        src={featured.image}
                                        alt={featured.title}
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                    />
                                </div>
                                <div className="p-6">
                                    <p className="t-p-sm text-ad-tag mb-2">{featured.date}</p>
                                    <h2 className="t-h4 text-white-90">
                                        {featured.title}
                                    </h2>
                                </div>
                            </div>
                        </Link>
                    </AnimatedSection>
                </Container>
            </section>

            {/* ── Divider ── */}
            <section className="pb-12 relative">
                <Container>
                    <div className="h-px w-full" style={{ background: "rgba(62, 40, 111, 0.35)" }} />
                </Container>
            </section>

            {/* ── Blog Grid ── */}
            <section className="pb-20 relative">
                {/* Background gradient */}
                <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
                    <img
                        src="https://framerusercontent.com/images/PEUUUxYckhxt8G82fn4Y0LPz5s.png"
                        alt=""
                        className="absolute"
                        style={{ width: 3296, height: 2255, transform: "translate(-50%, -50%)", left: "50%", top: "50%", filter: "sepia(1) hue-rotate(230deg) saturate(2)" }}
                    />
                </div>
                <Container className="relative z-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                        {grid.map((post, i) => (
                            <AnimatedSection key={`${post.slug}-${i}`} delay={i * 0.08}>
                                <Link href={`/blog/${post.slug}`} className="block group h-full">
                                    <div className="card overflow-hidden rounded-3xl h-full flex flex-col">
                                        <div className="relative aspect-16/10 overflow-hidden">
                                            <img
                                                src={post.image}
                                                alt={post.title}
                                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                            />
                                        </div>
                                        <div className="p-6 flex flex-col flex-1">
                                            <p className="t-p-sm text-ad-tag mb-2">
                                                {post.date}
                                            </p>
                                            <h3 className="t-p-semibold text-white-90 leading-snug">
                                                {post.title}
                                            </h3>
                                        </div>
                                    </div>
                                </Link>
                            </AnimatedSection>
                        ))}
                    </div>
                </Container>
            </section>
        </>
    );
}
