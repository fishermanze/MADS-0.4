import { useState } from "react";

interface StarRatingProps {
  value: number | null | undefined;
  max?: number;
  readOnly?: boolean;
  size?: number;
  onChange?: (next: number) => void;
}

function StarRating({ value, max = 5, readOnly = false, size = 22, onChange }: StarRatingProps) {
  const [hover, setHover] = useState<number>(0);
  const current = Math.max(0, Math.min(max, Math.round(value ?? 0)));
  const display = hover > 0 ? hover : current;

  const handleClick = (idx: number) => {
    if (readOnly) {
      return;
    }
    onChange?.(idx === current ? 0 : idx);
  };

  return (
    <div
      role="radiogroup"
      aria-label="星级评分"
      style={{
        display: "inline-flex",
        gap: "4px",
        cursor: readOnly ? "default" : "pointer",
        userSelect: "none",
      }}
      onMouseLeave={() => setHover(0)}
    >
      {Array.from({ length: max }, (_, i) => i + 1).map((idx) => {
        const filled = idx <= display;
        return (
          <span
            key={idx}
            role="radio"
            aria-checked={idx === current}
            tabIndex={readOnly ? -1 : 0}
            onClick={() => handleClick(idx)}
            onMouseEnter={() => !readOnly && setHover(idx)}
            onKeyDown={(e) => {
              if (readOnly) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick(idx);
              }
            }}
            style={{
              fontSize: `${size}px`,
              lineHeight: 1,
              color: filled ? "#f59e0b" : "#d1d5db",
              transition: "color 0.15s ease, transform 0.15s ease",
              transform: !readOnly && hover === idx ? "scale(1.1)" : "scale(1)",
            }}
          >
            ★
          </span>
        );
      })}
    </div>
  );
}

export default StarRating;
