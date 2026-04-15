"use client";

import React, { useState, useEffect, useRef, startTransition, useMemo } from "react";

interface TypewriterEffectProps {
    textList: string[];
    speed?: number;
    cycle?: boolean;
    className?: string;
    cursorChar?: string;
    cursorColor?: string;
    textColor?: string;
}

export default function TypewriterEffect({
    textList = ["Hello World!", "Welcome to Adray"],
    speed = 100,
    cycle = true,
    className,
    cursorChar = "|",
    cursorColor,
    textColor,
}: TypewriterEffectProps) {
    const [textIndex, setTextIndex] = useState(0);
    const [charIndex, setCharIndex] = useState(0);
    const [isDeleting, setIsDeleting] = useState(false);
    const [displayed, setDisplayed] = useState("");
    const [blinking, setBlinking] = useState(true);
    const [pause, setPause] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const currentText =
        textList && textList.length > 0
            ? textList[textIndex % textList.length]
            : "";

    const cursorFinalColor = cursorColor || textColor || "currentColor";

    // Blinking cursor
    useEffect(() => {
        const blink = setInterval(() => {
            setBlinking((b) => !b);
        }, 500);
        return () => clearInterval(blink);
    }, []);

    // Typewriter logic
    useEffect(() => {
        if (!currentText) return;
        if (pause) return;
        if (!cycle && textIndex >= textList.length) return;

        if (!isDeleting && charIndex <= currentText.length) {
            timeoutRef.current = setTimeout(() => {
                startTransition(() => {
                    setDisplayed(currentText.slice(0, charIndex));
                    setCharIndex((i) => i + 1);
                });
            }, speed);
        } else if (!isDeleting && charIndex > currentText.length) {
            timeoutRef.current = setTimeout(() => {
                if (cycle) {
                    startTransition(() => setIsDeleting(true));
                } else {
                    setPause(true);
                }
            }, 1000);
        } else if (isDeleting && charIndex > 0) {
            timeoutRef.current = setTimeout(() => {
                startTransition(() => {
                    setDisplayed(currentText.slice(0, charIndex - 1));
                    setCharIndex((i) => i - 1);
                });
            }, speed / 2);
        } else if (isDeleting && charIndex === 0) {
            timeoutRef.current = setTimeout(() => {
                startTransition(() => {
                    setIsDeleting(false);
                    setTextIndex((i) =>
                        cycle ? (i + 1) % textList.length : i + 1
                    );
                });
            }, 400);
        }

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [charIndex, isDeleting, textIndex, cycle, currentText, speed, textList.length, pause]);

    // Reset on prop change
    useEffect(() => {
        startTransition(() => {
            setTextIndex(0);
            setCharIndex(0);
            setIsDeleting(false);
            setDisplayed("");
            setPause(false);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(textList), speed, cycle]);

    const cursorStyle = useMemo(
        () => ({
            color: cursorFinalColor,
            opacity: blinking ? 1 : 0,
            transition: "opacity 0.2s",
        }),
        [cursorFinalColor, blinking]
    );

    return (
        <span className={className} aria-live="polite">
            {displayed}
            <span style={cursorStyle} aria-hidden="true">
                {cursorChar}
            </span>
        </span>
    );
}
