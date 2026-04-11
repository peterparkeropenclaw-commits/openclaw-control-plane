"use client";
import React, { useEffect, useRef, useState } from "react";

type Props = {
  children: React.ReactNode;
  className?: string;
  delay?: number; // milliseconds
};

export default function Reveal({ children, className = "", delay = 0 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setVisible(true);
      return;
    }

    const el = ref.current;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setTimeout(() => setVisible(true), delay);
          obs.unobserve(el);
        }
      });
    }, { threshold: 0.12 });

    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);

  const baseStyle: React.CSSProperties = {
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0px)" : "translateY(24px)",
    transition: "opacity var(--motion-slow, 480ms) var(--ease-out, cubic-bezier(0.2, 0.9, 0.2, 1)), transform var(--motion-slow, 480ms) var(--ease-out, cubic-bezier(0.2, 0.9, 0.2, 1))",
    willChange: "opacity, transform",
  };

  return (
    <div ref={ref} className={className} style={baseStyle}>
      {children}
    </div>
  );
}
