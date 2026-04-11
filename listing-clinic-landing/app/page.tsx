"use client";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#E8DDD0] flex items-center justify-center px-4">
      <div className="max-w-4xl w-full">
        {/* Hero */}
        <section className="text-center py-12">
          <h1 className="font-[family-name:var(--font-playfair)] text-5xl font-bold text-[#1C2B3A] mb-4">
            STR Clinic — Listing help that pays for itself
          </h1>
          <p className="font-[family-name:var(--font-inter)] text-[#1C2B3A]/70 text-lg mb-4 leading-relaxed">
            Free diagnostic audit for Airbnb hosts. We score your listing out of 100 across 5 pillars, identify your key weaknesses, and estimate what each one is costing you in lost revenue. Want everything fixed? The full STR Clinic delivers rewritten copy, pricing strategy, platform expansion guide, and more — from £199.
          </p>
          <div className="flex items-center justify-center gap-4 mt-6">
            <Link href="/audit" className="bg-[#C4500A] text-white px-6 py-3 rounded-full text-lg font-bold">Get a free audit</Link>
            <Link href="/buy" className="bg-[#1C2B3A] text-white px-6 py-3 rounded-full text-lg font-bold">Buy full report — £199</Link>
          </div>
          <p className="text-sm text-[#1C2B3A]/60 mt-3">Delivered within 24 hours.</p>
        </section>

        {/* Steps */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 my-12">
          <div className="p-6 bg-white rounded-lg">
            <h3 className="font-semibold mb-2">Step 01</h3>
            <p className="text-sm text-[#1C2B3A]/70">Submit your listing URL and email.</p>
          </div>
          <div className="p-6 bg-white rounded-lg">
            <h3 className="font-semibold mb-2">Step 02</h3>
            <p className="text-sm text-[#1C2B3A]/70">Scored across 5 pillars: Title, Photos, Description, Pricing, and Platform. Overall score out of 100, with a main insight, quick win, and platform revenue opportunity estimate. Delivered as a PDF within 24 hours.</p>
          </div>
          <div className="p-6 bg-white rounded-lg">
            <h3 className="font-semibold mb-2">Step 03</h3>
            <p className="text-sm text-[#1C2B3A]/70">Free audit is actionable; upgrade for a full rewrite and pricing strategy.</p>
          </div>
        </section>

        {/* Pricing cards */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6 my-8">
          {/* Free audit card */}
          <div className="p-6 bg-white rounded-lg">
            <h4 className="text-xl font-bold mb-4">Free Diagnostic Audit</h4>
            <ul className="space-y-3 mb-8">
              {[
                "Score out of 100 across 5 pillars: Title, Photos, Description, Pricing, Platform",
                "Main insight specific to your listing",
                "One quick win you can action today",
                "Platform revenue opportunity estimate",
                "Two alternative platform recommendations with revenue benchmarks",
                "Personal note from Brandon, STR host & founder",
                "Delivered as PDF within 24 hours",
                "Free — no card, no catch",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-[#1C2B3A]/70 font-[family-name:var(--font-inter)]">
                  <span className="text-[#C4500A] mt-0.5">✓</span>
                  {item}
                </li>
              ))}
            </ul>
            <Link href="/audit" className="inline-block bg-[#C4500A] text-white px-5 py-3 rounded-full">Request free audit</Link>
          </div>

          {/* Paid £199 card - dark navy */}
          <div className="p-6 rounded-lg bg-[#1C2B3A] text-white">
            <h4 className="text-xl font-bold mb-4">STR Clinic — Full Report</h4>
            <p className="mb-6 text-sm">One-off £199 — full PDF report, rewritten copy, pricing strategy and platform expansion guide.</p>
            <Link href="/buy" className="inline-block bg-[#E8C840] text-[#0A1628] px-5 py-3 rounded-full">Buy — £199</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
