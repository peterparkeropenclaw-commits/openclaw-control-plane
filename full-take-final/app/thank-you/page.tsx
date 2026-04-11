export default function ThankYou() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0A1628] text-white px-6">
      <div className="max-w-2xl w-full text-center">
        <div className="text-[#E8C840] text-8xl">✓</div>
        <h1 className="mt-6 text-3xl font-[family-name:var(--font-barlow-condensed)] font-extrabold text-white">You're booked in.</h1>
        <p className="mt-4 text-gray-200">Brandon will review your listing and deliver your full clinic within 48 hours. Check your inbox for confirmation.</p>
        <a href="/" className="inline-block mt-6 bg-[#E8C840] text-[#0A1628] px-6 py-3 rounded-full font-[family-name:var(--font-barlow-condensed)] font-extrabold">Back to homepage</a>
      </div>
    </main>
  );
}
