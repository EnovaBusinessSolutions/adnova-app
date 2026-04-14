"use client";

import React from "react";
import Container from "@/components/ui/Container";
import ScrollTextColor from "@/components/ui/ScrollTextColor";

/** Paths incrustados: evita <img>+filtros y rutas /landing en estático (más fiable en prod). */
const CENTER_LOGO_PATHS = [
    {
        alt: "ChatGPT",
        d: "M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872v.024zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66v.018zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681l-.004 6.722zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z",
    },
    {
        alt: "Claude",
        d: "M4.709 15.955l4.397-2.398a.4.4 0 0 0 .206-.35V6.051a.4.4 0 0 0-.6-.347L4.314 8.102a.8.8 0 0 0-.405.696v6.81a.4.4 0 0 0 .8.347zm14.582-7.91l-4.397 2.398a.4.4 0 0 0-.206.35v7.156a.4.4 0 0 0 .6.347l4.398-2.398a.8.8 0 0 0 .405-.696v-6.81a.4.4 0 0 0-.8-.347zM12 1.5a.4.4 0 0 0-.194.05L7.409 3.948a.4.4 0 0 0 0 .694l4.397 2.398a.4.4 0 0 0 .388 0l4.397-2.398a.4.4 0 0 0 0-.694L12.194 1.55A.4.4 0 0 0 12 1.5z",
    },
    {
        alt: "Gemini",
        d: "M12 2L8.5 8.5 2 12l6.5 3.5L12 22l3.5-6.5L22 12l-6.5-3.5L12 2zm0 4.34L13.83 10 10 11.83 8.17 10 12 6.34zM6.34 12L10 13.83 11.83 18 10 14 6.34 12zm11.32 0L14 13.83 12.17 18 14 14l3.66-2zM12 10l2 2-2 2-2-2 2-2z",
    },
] as const;

export default function HighlightedText() {
    const [centerLogoIndex, setCenterLogoIndex] = React.useState(0);

    React.useEffect(() => {
        const interval = window.setInterval(() => {
            setCenterLogoIndex((prev) => (prev + 1) % CENTER_LOGO_PATHS.length);
        }, 3000);

        return () => window.clearInterval(interval);
    }, []);

    return (
        <section className="py-20 relative">
            <Container className="flex flex-col lg:flex-row items-center gap-16">
                {/* Text — scroll-animated color */}
                <div className="flex-1">
                    <ScrollTextColor
                        content="Your AI chat is now your marketing analytics. No new tool to learn. No dashboard to log into. Just your data, reconciled, packed, and ready, wherever you already work."
                        colorStart="#3E286F"
                        colorEnd="#FFFFFF"
                        trigger="layer-in-view"
                        animationStart="center"
                        animationEnd="bottom"
                        className="t-h3-lg tracking-[-0.03em]"
                        style={{ fontFamily: 'var(--font-display)' }}
                    />
                </div>

                {/* Illustration — rotating gradient + tool logos cluster */}
                <div className="shrink-0 relative w-[340px] h-[340px] md:w-[400px] md:h-[400px]">
                    {/* Gradient circle background */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="https://framerusercontent.com/images/emEabgUGaj1mrFtUh9nCcNLOsk.webp"
                        alt=""
                        className="absolute inset-0 w-full h-full object-contain animate-rotate"
                        style={{ animationDuration: "8s", filter: "brightness(1.33) sepia(1) hue-rotate(230deg) saturate(2)" }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div
                            className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 md:h-20 md:w-20"
                            style={{
                                background: "rgba(0,0,0,0.35)",
                                backdropFilter: "blur(8px)",
                                WebkitBackdropFilter: "blur(8px)",
                            }}
                        >
                            <svg
                                role="img"
                                aria-label={CENTER_LOGO_PATHS[centerLogoIndex].alt}
                                viewBox="0 0 24 24"
                                fill="#ffffff"
                                className="h-8 w-8 shrink-0 md:h-10 md:w-10"
                            >
                                <path d={CENTER_LOGO_PATHS[centerLogoIndex].d} />
                            </svg>
                        </div>
                    </div>
                </div>
            </Container>
        </section>
    );
}
