import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import React from "react";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Replace every occurrence of "Adray" in a string (case-insensitive) with a
 * <span> styled in the UlmGrotesk-Bold brand font.
 */
export function brandify(text: string): React.ReactNode {
    const parts = text.split(/(Adray)/gi);
    if (parts.length === 1) return text;
    return parts.map((part, i) =>
        /^Adray$/i.test(part)
            ? React.createElement("span", { key: i, style: { fontFamily: "var(--font-brand)" } }, part)
            : part
    );
}
