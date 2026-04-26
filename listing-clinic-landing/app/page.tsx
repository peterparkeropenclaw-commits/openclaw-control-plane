"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";

const NAVY = "#0A1628";
const GOLD = "#E8C840";

const auditSignals = [
  { label: "Search positioning", score: "Directional", note: "Does the title lead with what guests actually filter and search for?" },
  { label: "Photo trust", score: "Visible", note: "Do the first images prove the stay quickly enough?" },
  { label: "Guest promise", score: "Clear / unclear", note: "Can a guest repeat the reason to book after ten seconds?" },
  { label: "Conversion friction", score: "Flagged", note: "Where copy, evidence, or pricing cues create hesitation." },
];

const sampleFindings = [
  "The listing leads with atmosphere before evidence, so the first impression may feel pleasant but not decisive.",
  "The strongest amenity proof is present, but it appears too late to help scanning guests compare options.",
  "Pricing and description cues should be reviewed together before making rate changes.",
];

const methodology = [
  "Public listing content only. No host login, guest data, calendar access, or private account information.",
  "Scores are directional bands, not false-precision rankings. They are based on visible listing evidence and computed audit inputs.",
  "Revenue language is treated as an opportunity estimate where confidence allows, otherwise it is softened or omitted.",
];

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<null | { ok: boolean; msg: string }>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    urlRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setStatus(null);

    if (!/airbnb\.|vrbo\./i.test(url)) {
      setStatus({ ok: false, msg: "Paste a public Airbnb or Vrbo listing URL." });
      return;
    }

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setStatus({ ok: false, msg: "Enter a valid email address." });
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/free-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_url: url, email }),
      });
      const j = await r.json().catch(() => null);

      if (r.ok) {
        setStatus({ ok: true, msg: "Your audit is queued. We’ll email the PDF when it’s ready." });
        setUrl("");
        setEmail("");
      } else {
        setStatus({ ok: false, msg: (j && j.error) || "Something went wrong. Please try again." });
      }
    } catch {
      setStatus({ ok: false, msg: "Something went wrong. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F3EA] text-[#0A1628]">
      <section className="px-5 py-8 md:px-8 md:py-10">
        <div className="mx-auto max-w-6xl rounded-[32px] border border-[#E4DED2] bg-[#FFFDF8] shadow-[0_24px_80px_rgba(10,22,40,0.08)] overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="p-7 md:p-12 lg:p-14">
              <p className="mb-6 inline-flex rounded-full border border-[#E4DED2] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#6B5B45]">
                Free diagnostic audit for short-term rental hosts
              </p>
              <h1 className="font-[family-name:var(--font-playfair)] text-5xl font-bold leading-[0.98] tracking-[-0.03em] text-[#0A1628] md:text-7xl">
                Find the clearest fixes before you spend another month guessing.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-[#405166]">
                STR Clinic reviews the public signals on your Airbnb or Vrbo listing and returns a concise PDF diagnosis: what is helping, what is holding bookings back, and what to fix first.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a href="#audit-form" className="inline-flex justify-center rounded-full bg-[#C4500A] px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white shadow-sm transition hover:bg-[#A94208]">
                  Request free audit
                </a>
                <a href="#sample-audit" className="inline-flex justify-center rounded-full border border-[#0A1628]/20 bg-white px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#0A1628] transition hover:border-[#0A1628]/45">
                  See sample output
                </a>
              </div>
              <p className="mt-4 text-sm text-[#66758A]">
                No login, no guest data, no card. The Full Clinic is only recommended if the audit shows meaningful upside.
              </p>
            </div>

            <div id="sample-audit" className="bg-[#0A1628] p-7 text-white md:p-10 lg:p-12">
              <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/10 pb-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#E8C840]">Sample audit excerpt</p>
                  <h2 className="mt-2 font-[family-name:var(--font-playfair)] text-3xl font-bold">Rowan Hollow Cabin</h2>
                </div>
                <div className="rounded-full border border-[#E8C840]/50 px-4 py-3 text-center">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#E8C840]">Signal</div>
                  <div className="font-semibold">Promising</div>
                </div>
              </div>
              <div className="space-y-3">
                {auditSignals.map((signal) => (
                  <div key={signal.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="font-semibold text-white">{signal.label}</h3>
                      <span className="shrink-0 rounded-full bg-[#E8C840] px-3 py-1 text-xs font-bold text-[#0A1628]">{signal.score}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-white/70">{signal.note}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-2xl bg-[#FFFDF8] p-5 text-[#0A1628]">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#C4500A]">Example finding</p>
                <p className="mt-2 font-[family-name:var(--font-playfair)] text-2xl font-bold leading-tight">
                  Your best proof exists, but it is not being used early enough.
                </p>
                <p className="mt-3 text-sm leading-6 text-[#405166]">
                  The audit shows the specific evidence to move higher in the listing before asking a guest to read the full description.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 py-14 md:px-8">
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          {[
            ["1", "Submit the public URL", "Paste an Airbnb or Vrbo listing and the email where the PDF should be sent."],
            ["2", "Receive a focused diagnosis", "We look for the most visible conversion and positioning issues, then summarise them in plain English."],
            ["3", "Decide whether deeper work is worth it", "If the free audit shows enough upside, the Full Clinic can turn the diagnosis into copy, pricing, and sequencing recommendations."],
          ].map(([n, title, body]) => (
            <article key={n} className="rounded-3xl border border-[#E4DED2] bg-[#FFFDF8] p-7">
              <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-full bg-[#E8C840] text-sm font-black text-[#0A1628]">{n}</div>
              <h2 className="font-[family-name:var(--font-playfair)] text-2xl font-bold">{title}</h2>
              <p className="mt-3 leading-7 text-[#405166]">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-[#FFFDF8] px-5 py-16 md:px-8">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#C4500A]">What the free audit proves</p>
            <h2 className="mt-4 font-[family-name:var(--font-playfair)] text-4xl font-bold leading-tight md:text-5xl">
              Helpful enough to act on. Bounded enough to stay honest.
            </h2>
            <p className="mt-5 text-lg leading-8 text-[#405166]">
              The free audit is not a generic scorecard or a hard sell. It gives a short, evidence-led view of the listing’s biggest visible opportunities, then makes the next step optional.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {sampleFindings.map((finding, index) => (
              <div key={finding} className={`rounded-3xl border border-[#E4DED2] p-6 ${index === 0 ? "bg-[#0A1628] text-white sm:col-span-2" : "bg-[#F7F3EA]"}`}>
                <p className={`text-xs font-bold uppercase tracking-[0.16em] ${index === 0 ? "text-[#E8C840]" : "text-[#C4500A]"}`}>Finding {index + 1}</p>
                <p className={`mt-3 text-lg leading-7 ${index === 0 ? "text-white/82" : "text-[#405166]"}`}>{finding}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-16 md:px-8">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
          <article className="rounded-[28px] border border-[#E4DED2] bg-[#FFFDF8] p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#C4500A]">Included free</p>
            <h2 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl font-bold">Diagnostic audit</h2>
            <ul className="mt-6 space-y-3 text-[#405166]">
              <li>✓ Directional listing score and short commercial diagnosis</li>
              <li>✓ Top visible issues across positioning, photos, copy, pricing cues, and trust signals</li>
              <li>✓ One practical first action, written for a host rather than an analyst</li>
              <li>✓ Methodology and confidence notes where claims need context</li>
            </ul>
            <a href="#audit-form" className="mt-7 inline-flex rounded-full bg-[#C4500A] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white">
              Get the free audit
            </a>
          </article>

          <article className="rounded-[28px] border border-[#0A1628]/15 bg-[#0A1628] p-8 text-white">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#E8C840]">Optional deeper work</p>
            <h2 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl font-bold">Full Clinic, £199</h2>
            <p className="mt-4 leading-7 text-white/75">
              Best when the free diagnosis shows the listing has enough visible upside to justify a deeper review. It expands the audit into a fuller commercial plan.
            </p>
            <ul className="mt-6 space-y-3 text-white/78">
              <li>✓ Paste-ready title and description direction</li>
              <li>✓ Photo sequencing and guest-trust recommendations</li>
              <li>✓ Pricing and competitor review where evidence supports it</li>
              <li>✓ Clearer implementation priorities, not a pile of vague ideas</li>
            </ul>
            <Link href="/buy" className="mt-7 inline-flex rounded-full bg-[#E8C840] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#0A1628]">
              View Full Clinic
            </Link>
          </article>
        </div>
      </section>

      <section className="bg-[#FFFDF8] px-5 py-16 md:px-8">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#C4500A]">Methodology and privacy</p>
            <h2 className="mt-4 font-[family-name:var(--font-playfair)] text-4xl font-bold leading-tight">A calmer way to diagnose a listing.</h2>
          </div>
          <div className="space-y-4">
            {methodology.map((item) => (
              <div key={item} className="rounded-2xl border border-[#E4DED2] bg-[#F7F3EA] p-5 leading-7 text-[#405166]">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="audit-form" className="px-5 py-16 md:px-8">
        <div className="mx-auto max-w-4xl rounded-[32px] border border-[#E4DED2] bg-[#FFFDF8] p-7 shadow-[0_20px_60px_rgba(10,22,40,0.08)] md:p-10">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#C4500A]">Request the free audit</p>
            <h2 className="mt-3 font-[family-name:var(--font-playfair)] text-4xl font-bold">See what your listing is really saying to guests.</h2>
            <p className="mx-auto mt-4 max-w-2xl leading-7 text-[#405166]">
              Paste the public listing URL. We’ll use it to generate and send the audit PDF. If deeper work is not obviously useful, the free audit still stands on its own.
            </p>
          </div>

          <form onSubmit={submit} className="mt-8 grid gap-4 md:grid-cols-[1fr_0.8fr_auto] md:items-end">
            <label className="block text-sm font-semibold text-[#243244]">
              Listing URL
              <input
                ref={urlRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.airbnb.com/rooms/12345678"
                className="mt-2 w-full rounded-2xl border border-[#D6CFC2] bg-white px-4 py-3 font-normal outline-none transition focus:border-[#C4500A] focus:ring-4 focus:ring-[#C4500A]/10"
              />
            </label>
            <label className="block text-sm font-semibold text-[#243244]">
              Email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-2 w-full rounded-2xl border border-[#D6CFC2] bg-white px-4 py-3 font-normal outline-none transition focus:border-[#C4500A] focus:ring-4 focus:ring-[#C4500A]/10"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-[#C4500A] px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#A94208] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Queuing..." : "Get audit"}
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-[#66758A]">
            We only use your URL and email to create and deliver the audit. We never contact guests.
          </div>
          {status && (
            <div className={`mt-5 rounded-2xl px-4 py-3 text-center text-sm font-semibold ${status.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
              {status.msg}
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-[#E4DED2] bg-[#FFFDF8] px-5 py-8 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 text-sm text-[#66758A] md:flex-row md:items-center md:justify-between">
          <div>
            <strong className="text-[#0A1628]">STR Clinic</strong> · listing diagnosis for short-term rental hosts
          </div>
          <div className="flex gap-5">
            <a href="#audit-form" className="text-[#0A1628]">Free audit</a>
            <Link href="/buy" className="text-[#0A1628]">Full Clinic</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
