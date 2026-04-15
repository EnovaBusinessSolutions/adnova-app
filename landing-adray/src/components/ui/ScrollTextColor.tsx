"use client";

import React, { useEffect, useState, useRef, useMemo, startTransition } from "react";
import { useScroll, useTransform, motion } from "framer-motion";

interface ScrollTextColorProps {
    content: string;
    colorStart?: string;
    colorEnd?: string;
    trigger?: "layer-in-view" | "scroll-position";
    animationStart?: "top" | "center" | "bottom";
    animationEnd?: "top" | "center" | "bottom";
    startOffset?: number;
    replay?: boolean;
    className?: string;
    style?: React.CSSProperties;
}

export default function ScrollTextColor({
    content = "Hello World",
    colorStart = "#8A7DA8",
    colorEnd = "#000000",
    trigger = "layer-in-view",
    animationStart = "bottom",
    animationEnd = "center",
    startOffset = 0,
    replay = true,
    className,
    style,
}: ScrollTextColorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [elementTop, setElementTop] = useState(0);
    const [elementHeight, setElementHeight] = useState(0);
    const [mounted, setMounted] = useState(false);

    const { scrollY } = useScroll();

    // Track mount state to avoid SSR issues
    useEffect(() => {
        setMounted(true);
    }, []);

    // Calculate element position
    useEffect(() => {
        if (!containerRef.current) return;

        const updatePosition = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                const scrollTop =
                    window.pageYOffset || document.documentElement.scrollTop;
                startTransition(() => {
                    setElementTop(rect.top + scrollTop);
                    setElementHeight(rect.height);
                });
            }
        };

        updatePosition();
        window.addEventListener("resize", updatePosition);
        return () => window.removeEventListener("resize", updatePosition);
    }, [content]);

    // Split content into words (preserving spaces)
    const characters = useMemo(() => {
        const words = content.split(/(\s+)/);
        return words.map((word, index) => ({
            word,
            index,
        }));
    }, [content]);

    // Calculate animation range
    const getAnimationRange = (): [number, number] => {
        const windowHeight =
            typeof window !== "undefined" ? window.innerHeight : 800;

        if (trigger === "scroll-position") {
            return [0, windowHeight];
        } else {
            const getPositionOffset = (position: string) => {
                switch (position) {
                    case "top":
                        return windowHeight;
                    case "center":
                        return windowHeight / 2;
                    case "bottom":
                        return 0;
                    default:
                        return 0;
                }
            };

            const startPos = elementTop - getPositionOffset(animationStart);
            const endPos = elementTop - getPositionOffset(animationEnd);
            return [startPos, endPos];
        }
    };

    // SSR fallback — render static text
    if (!mounted) {
        return (
            <div
                ref={containerRef}
                className={className}
                style={{ ...style, color: colorStart }}
            >
                {content}
            </div>
        );
    }

    const [animationStartPos, animationEndPos] = getAnimationRange();
    const animationDistance = animationEndPos - animationStartPos;

    return (
        <div
            ref={containerRef}
            className={className}
            style={{
                ...style,
                wordWrap: "break-word",
                overflowWrap: "break-word",
                whiteSpace: "normal",
            }}
        >
            {characters.map((item) => {
                const wordStartPos =
                    animationStartPos +
                    (item.index / characters.length) * animationDistance +
                    startOffset;
                const wordEndPos =
                    animationStartPos +
                    ((item.index + 1) / characters.length) * animationDistance +
                    startOffset;

                return (
                    <ScrollWord
                        key={item.index}
                        word={item.word}
                        scrollY={scrollY}
                        wordStartPos={wordStartPos}
                        wordEndPos={wordEndPos}
                        colorStart={colorStart}
                        colorEnd={colorEnd}
                        replay={replay}
                    />
                );
            })}
        </div>
    );
}

/**
 * Individual word component that animates color based on scroll.
 * Extracted to its own component so hooks are called unconditionally.
 */
function ScrollWord({
    word,
    scrollY,
    wordStartPos,
    wordEndPos,
    colorStart,
    colorEnd,
    replay,
}: {
    word: string;
    scrollY: ReturnType<typeof useScroll>["scrollY"];
    wordStartPos: number;
    wordEndPos: number;
    colorStart: string;
    colorEnd: string;
    replay: boolean;
}) {
    const wordProgress = useTransform(
        scrollY,
        [wordStartPos, wordEndPos],
        [0, 1],
        { clamp: !replay }
    );

    const color = useTransform(wordProgress, [0, 1], [colorStart, colorEnd]);

    const isAdray = /^Adray$/i.test(word.trim());

    return (
        <motion.span style={{ color, display: "inline", ...(isAdray ? { fontFamily: "var(--font-brand)" } : {}) }}>
            {word}
        </motion.span>
    );
}
