"use client";

import React, { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { cn } from "@/lib/utils";

interface AnimatedSectionProps {
    children: React.ReactNode;
    className?: string;
    delay?: number;
    direction?: "up" | "down" | "left" | "right";
}

const directionMap = {
    up: { y: 40, x: 0 },
    down: { y: -40, x: 0 },
    left: { y: 0, x: 40 },
    right: { y: 0, x: -40 },
};

export default function AnimatedSection({
    children,
    className,
    delay = 0,
    direction = "up",
}: AnimatedSectionProps) {
    const ref = useRef(null);
    const isInView = useInView(ref, { once: true, margin: "-80px" });

    return (
        <motion.div
            ref={ref}
            initial={{
                opacity: 0,
                y: directionMap[direction].y,
                x: directionMap[direction].x,
            }}
            animate={
                isInView
                    ? { opacity: 1, y: 0, x: 0 }
                    : {
                        opacity: 0,
                        y: directionMap[direction].y,
                        x: directionMap[direction].x,
                    }
            }
            transition={{
                duration: 0.7,
                delay,
                ease: [0.21, 0.47, 0.32, 0.98],
            }}
            className={cn(className)}
        >
            {children}
        </motion.div>
    );
}
