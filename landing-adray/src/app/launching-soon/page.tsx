"use client";

import React, { useState, useEffect } from "react";
import Container from "@/components/ui/Container";
import Button from "@/components/ui/Button";
import AnimatedSection from "@/components/ui/AnimatedSection";
import { Rocket } from "lucide-react";

function useCountdown(targetDate: Date) {
    const [timeLeft, setTimeLeft] = useState({
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
    });

    useEffect(() => {
        const interval = setInterval(() => {
            const now = new Date().getTime();
            const distance = targetDate.getTime() - now;

            if (distance < 0) {
                clearInterval(interval);
                return;
            }

            setTimeLeft({
                days: Math.floor(distance / (1000 * 60 * 60 * 24)),
                hours: Math.floor(
                    (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
                ),
                minutes: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
                seconds: Math.floor((distance % (1000 * 60)) / 1000),
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [targetDate]);

    return timeLeft;
}

export default function LaunchingSoonPage() {
    // Set launch date to September 12, 2026
    const launchDate = new Date("2026-09-12T00:00:00");
    const timeLeft = useCountdown(launchDate);
    const [email, setEmail] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        alert(`Thank you! We'll notify ${email} when we launch.`);
        setEmail("");
    };

    return (
        <section className="min-h-screen flex items-center justify-center relative overflow-hidden">

            <Container className="relative z-10 text-center py-20">
                <AnimatedSection>
                    <div className="flex justify-center mb-8">
                        <div className="w-20 h-20 rounded-2xl bg-ad-primary/10 border border-ad-primary/20 flex items-center justify-center">
                            <Rocket size={36} className="text-ad-primary" />
                        </div>
                    </div>

                    <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-6">
                        Something amazing is
                        <br />
                        <span className="text-gradient">launching soon</span>
                    </h1>

                    <p className="text-ad-muted text-lg max-w-xl mx-auto mb-12">
                        We&apos;re putting the finishing touches on something incredible. Be the
                        first to know when we launch.
                    </p>

                    {/* Countdown */}
                    <div className="flex justify-center gap-4 sm:gap-8 mb-12">
                        {[
                            { value: timeLeft.days, label: "Days" },
                            { value: timeLeft.hours, label: "Hours" },
                            { value: timeLeft.minutes, label: "Minutes" },
                            { value: timeLeft.seconds, label: "Seconds" },
                        ].map((item) => (
                            <div key={item.label} className="text-center">
                                <div className="w-16 h-16 sm:w-20 sm:h-20 card rounded-xl flex items-center justify-center mb-2">
                                    <span className="text-2xl sm:text-3xl font-bold text-white">
                                        {String(item.value).padStart(2, "0")}
                                    </span>
                                </div>
                                <span className="text-xs text-ad-muted">{item.label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Email signup */}
                    <form
                        onSubmit={handleSubmit}
                        className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
                    >
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="flex-1 px-4 py-3 rounded-full bg-ad-dark border border-ad-border text-white text-sm placeholder:text-ad-muted/50 focus:border-ad-primary focus:outline-none transition-colors"
                            placeholder="Enter your email"
                        />
                        <Button variant="primary" size="md" type="submit">
                            Notify Me
                        </Button>
                    </form>
                </AnimatedSection>
            </Container>
        </section>
    );
}
