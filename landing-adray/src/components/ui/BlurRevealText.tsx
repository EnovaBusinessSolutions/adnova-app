"use client";

import React from "react";
import { motion, useInView } from "framer-motion";

interface BlurRevealTextProps {
    text: string;
    className?: string;
    startDelay?: number;
    /** If true, animation triggers when scrolled into view instead of on mount */
    triggerOnScroll?: boolean;
}

export default function BlurRevealText({
    text,
    className,
    startDelay = 0,
    triggerOnScroll = false,
}: BlurRevealTextProps) {
    const ref = React.useRef<HTMLSpanElement>(null);
    const isInView = useInView(ref, { once: true, margin: "-10% 0px" });
    const shouldAnimate = triggerOnScroll ? isInView : true;

    const words = text.split(" ");
    // Total character count before each word (for per-char delay timing)
    let charOffset = 0;

    return (
        <span ref={ref} className={className} style={{ overflowWrap: "break-word" }}>
            {words.map((word, wi) => {
                const wordStart = charOffset;
                charOffset += word.length + 1; // +1 for the space
                return (
                    <React.Fragment key={wi}>
                        <span className="inline-block" style={/^Adray$/i.test(word) ? { fontFamily: 'var(--font-brand)' } : undefined}>
                            {word.split("").map((char, ci) => (
                                <motion.span
                                    key={ci}
                                    className="inline-block"
                                    initial={{ opacity: 0.001, filter: "blur(10px)", y: 10 }}
                                    animate={
                                        shouldAnimate
                                            ? { opacity: 1, filter: "blur(0px)", y: 0 }
                                            : { opacity: 0.001, filter: "blur(10px)", y: 10 }
                                    }
                                    transition={{
                                        duration: 0.4,
                                        delay: startDelay + (wordStart + ci) * 0.025,
                                        ease: [0.21, 0.47, 0.32, 0.98],
                                    }}
                                >
                                    {char}
                                </motion.span>
                            ))}
                        </span>
                        {wi < words.length - 1 && " "}
                    </React.Fragment>
                );
            })}
        </span>
    );
}
