"use client";
import React, { useEffect, useRef, useState } from "react";

const NAVY = "#0A1628";
const GOLD = "#E8C840";

export default function Accordion({ items }: { items: { q: string; a: string }[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const prefersReduced = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div>
      {items.map((it, i) => (
        <AccordionItem
          key={i}
          index={i}
          open={openIndex === i}
          onToggle={() => setOpenIndex(openIndex === i ? null : i)}
          q={it.q}
          a={it.a}
          prefersReduced={prefersReduced}
        />
      ))}
    </div>
  );
}

function AccordionItem({ index, open, onToggle, q, a, prefersReduced }: { index: number; open: boolean; onToggle: () => void; q: string; a: string; prefersReduced: boolean }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [maxH, setMaxH] = useState<string>(open ? "1000px" : "0px");

  useEffect(() => {
    if (!contentRef.current) return;
    const el = contentRef.current;
    if (open) {
      const h = el.scrollHeight;
      setMaxH(`${h}px`);
    } else {
      setMaxH("0px");
    }
  }, [open]);

  const panelId = `accordion-panel-${index}`;
  const buttonId = `accordion-button-${index}`;

  return (
    <div style={{ marginBottom: 12, background: "#fff", padding: 14, borderRadius: 6, border: "1px solid #eee" }}>
      <button
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        style={{ background: "transparent", border: 0, textAlign: "left", width: "100%", padding: 0, cursor: "pointer" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 900, color: NAVY, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: 0.6 }}>{q}</div>
          <div style={{ color: GOLD, fontWeight: 900, transform: open ? "rotate(45deg)" : "rotate(0deg)", transition: prefersReduced ? "none" : "transform 200ms", fontSize: 18 }}>{open ? "−" : "+"}</div>
        </div>
      </button>

      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        ref={contentRef}
        style={{
          overflow: "hidden",
          maxHeight: maxH,
          transition: prefersReduced ? "none" : "max-height 300ms ease",
          marginTop: 8,
          color: "rgba(10,22,40,0.8)",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div style={{ paddingBottom: 4 }}>{a}</div>
      </div>
    </div>
  );
}
