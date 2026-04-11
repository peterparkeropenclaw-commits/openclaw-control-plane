"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BuyPage() {
  const router = useRouter();
  const [listingUrl, setListingUrl] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_url: listingUrl, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Checkout failed");
      // redirect to stripe
      if (data.url) window.location.href = data.url;
    } catch (err: any) {
      setError(err.message || String(err));
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0A1628] text-white px-6">
      <div className="max-w-3xl w-full bg-white/5 p-8 rounded-md">
        <h1 className="text-3xl font-[family-name:var(--font-barlow-condensed)] font-extrabold text-[#E8C840]">The Full STR Clinic — £199</h1>
        <p className="mt-2 text-lg text-gray-200">Paste-ready copy. 12-month pricing plan. Delivered in 48 hours.</p>

        <ul className="mt-6 space-y-2 text-gray-100">
          {[
            "Rewritten title & description (paste-ready)",
            "Photo order plan with rationale",
            "12-month pricing calendar",
            "Competitor analysis",
            "Guest communication templates",
            "Platform expansion guide (Vrbo, Booking.com, Canopy & Stars)",
            "Revenue impact table",
            "Full scored audit (everything in the free audit, plus all of the above)",
          ].map((item) => (
            <li key={item} className="flex items-start gap-3">
              <span className="text-[#E8C840] font-bold">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-sm text-gray-300">Brandon reviews every paid clinic personally.</p>

        <form onSubmit={handleSubmit} className="mt-6 grid grid-cols-1 gap-3">
          <label className="flex flex-col">
            <span className="text-sm text-gray-200">Listing URL</span>
            <input required type="url" value={listingUrl} onChange={(e)=>setListingUrl(e.target.value)} className="mt-1 p-3 rounded border border-transparent bg-white/5 text-white" placeholder="https://www.airbnb.com/rooms/..." />
          </label>

          <label className="flex flex-col">
            <span className="text-sm text-gray-200">Email</span>
            <input required type="email" value={email} onChange={(e)=>setEmail(e.target.value)} className="mt-1 p-3 rounded border border-transparent bg-white/5 text-white" placeholder="you@domain.com" />
          </label>

          {error && <div className="text-sm text-red-400">{error}</div>}

          <button disabled={loading} type="submit" className="mt-2 inline-flex items-center justify-center gap-2 bg-[#E8C840] text-[#0A1628] font-[family-name:var(--font-barlow-condensed)] font-extrabold uppercase px-8 py-3 rounded-full text-lg">
            {loading ? "Processing…" : "Buy Full Clinic — £199"}
          </button>
        </form>
      </div>
    </main>
  );
}
