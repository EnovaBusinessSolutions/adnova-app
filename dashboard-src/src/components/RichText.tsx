import React from "react";

function renderBoldInline(line: string) {
  // Divide por tokens tipo **algo**
  const parts = line.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    if (m) return <strong key={i}>{m[1]}</strong>;
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

export default function RichText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const t = String(text || "");
  const lines = t.split("\n");

  return (
    <div className={className}>
      {lines.map((line, idx) => (
        <div key={idx} className="whitespace-pre-wrap">
          {renderBoldInline(line)}
        </div>
      ))}
    </div>
  );
}