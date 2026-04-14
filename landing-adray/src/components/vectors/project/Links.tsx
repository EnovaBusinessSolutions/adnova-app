import React from "react";

interface LinksProps extends React.SVGProps<SVGSVGElement> {
    size?: number;
}

export default function Links({ size = 24, ...props }: LinksProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            {...props}
        >
            {/* TODO: Replace with actual vector paths */}
        </svg>
    );
}
