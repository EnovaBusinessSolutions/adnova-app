"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Container from "@/components/ui/Container";
import { pub } from "@/lib/paths";
import SectionHeading from "@/components/ui/SectionHeading";
import AnimatedSection from "@/components/ui/AnimatedSection";
import { brandify } from "@/lib/utils";

const testimonials = [
    {
        quote:
            "We were spending $50k a month on ads and had no idea what was actually working. Adray showed us our real ROAS for the first time \u2014 turns out Meta was overclaiming by 3x. We cut wasted spend by 40% in the first month.",
        author: "Priya Nair",
        role: "Head of Growth, Altara Commerce",
        image:
            "https://framerusercontent.com/images/d4SpmpLmhUfMZkWsTOukrdAmhg.jpg",
    },
    {
        quote:
            "I connected Adray to ChatGPT and asked about last week\u2019s ROAS. For the first time, I got an answer that matched reality \u2014 not what Meta or Google wanted me to believe. Setup took under 5 minutes.",
        author: "Daniel Reyes",
        role: "Ecommerce Director, LuminaTech",
        image:
            "https://framerusercontent.com/images/BIY5osAhJGxk35JHUCh9nq0Wro.jpg",
    },
    {
        quote:
            "The budget reallocation agent paid for itself in the first week. It caught a creative fatigue issue we would have missed for days and automatically shifted spend to our best-performing campaigns.",
        author: "Sarah Mitchell",
        role: "Marketing Lead, Nexora",
        image:
            "https://framerusercontent.com/images/oUkBi1c8nERocfQrJWNLxZ9Fipw.jpg",
    },
];

const slideVariants = {
    enter: (direction: number) => ({
        x: direction > 0 ? 300 : -300,
        opacity: 0,
    }),
    center: {
        x: 0,
        opacity: 1,
    },
    exit: (direction: number) => ({
        x: direction > 0 ? -300 : 300,
        opacity: 0,
    }),
};

export default function Testimonials() {
    const [current, setCurrent] = useState(0);
    const [direction, setDirection] = useState(0);

    const paginate = useCallback(
        (dir: number) => {
            setDirection(dir);
            setCurrent((prev) => {
                const next = prev + dir;
                if (next < 0) return testimonials.length - 1;
                if (next >= testimonials.length) return 0;
                return next;
            });
        },
        []
    );

    const t = testimonials[current];

    return (
        <section className="py-20 relative overflow-hidden">
            {/* Background gradient */}
            <div
                className="absolute inset-0 opacity-30"
                style={{
                    backgroundImage:
                        "url(https://framerusercontent.com/images/i8sq3FWUDAbUH2kTIeqGIMeGrwE.webp)",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    filter: "sepia(1) hue-rotate(230deg) saturate(2)",
                }}
            />

            <Container className="relative z-10">
                <AnimatedSection>
                    <SectionHeading
                        tag="REAL RESULTS"
                        tagIcon={
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={pub("/images/svg/BbcmkQqb9ghruMNQHqLHlo3xDs.svg")}
                                alt=""
                                width={24}
                                height={24}
                            />
                        }
                        title="Merchants who stopped guessing."
                        subtitle=""
                    />
                </AnimatedSection>

                {/* Testimonial card */}
                <AnimatedSection delay={0.15}>
                    <div className="relative overflow-hidden min-h-[320px] md:min-h-[280px]">
                        <AnimatePresence initial={false} custom={direction} mode="wait">
                            <motion.div
                                key={current}
                                custom={direction}
                                variants={slideVariants}
                                initial="enter"
                                animate="center"
                                exit="exit"
                                transition={{
                                    x: { type: "spring", stiffness: 300, damping: 30 },
                                    opacity: { duration: 0.2 },
                                }}
                                className="flex flex-col md:flex-row gap-6 md:gap-8 items-stretch"
                            >
                                {/* Portrait image */}
                                <div className="w-full md:w-[280px] shrink-0">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={t.image}
                                        alt={t.author}
                                        className="w-full h-[300px] md:h-full rounded-2xl object-cover"
                                        style={{ objectPosition: "center top" }}
                                    />
                                </div>

                                {/* Quote content */}
                                <div className="flex-1 flex flex-col justify-between">
                                    <blockquote className="t-p md:text-lg text-white-90 leading-relaxed mb-8">
                                        &ldquo;{brandify(t.quote)}&rdquo;
                                    </blockquote>
                                    <div>
                                        <p className="t-p font-semibold text-white-90">
                                            {t.author}
                                        </p>
                                        <p className="t-p-sm text-ad-muted mt-1">{t.role}</p>
                                    </div>
                                </div>
                            </motion.div>
                        </AnimatePresence>
                    </div>

                    {/* Navigation arrows */}
                    <div className="flex items-center justify-center gap-4 mt-8">
                        <button
                            onClick={() => paginate(-1)}
                            className="w-12 h-12 rounded-full border border-ad-border bg-white-7 flex items-center justify-center hover:bg-white-10 transition-colors cursor-pointer"
                            aria-label="Previous testimonial"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={pub("/images/svg/6tTbkXggWgQCAJ4DO2QEdXXmgM.svg")}
                                alt="Previous"
                                width={20}
                                height={20}
                                style={{ filter: "invert(1)" }}
                            />
                        </button>
                        <button
                            onClick={() => paginate(1)}
                            className="w-12 h-12 rounded-full border border-ad-border bg-white-7 flex items-center justify-center hover:bg-white-10 transition-colors cursor-pointer"
                            aria-label="Next testimonial"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={pub("/images/svg/11KSGbIZoRSg4pjdnUoif6MKHI.svg")}
                                alt="Next"
                                width={20}
                                height={20}
                                style={{ filter: "invert(1)" }}
                            />
                        </button>
                    </div>
                </AnimatedSection>
            </Container>
        </section>
    );
}
