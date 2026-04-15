import React from "react";

interface WebProps extends React.SVGProps<SVGSVGElement> {
    size?: number;
}

export default function Web({ size = 24, ...props }: WebProps) {
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
