import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { listing_url, email } = await req.json();
  if (!listing_url || !email) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  if (!/airbnb\.|vrbo\./i.test(listing_url)) return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  try {
    const WEBHOOK_URL = process.env.AUDIT_WEBHOOK_URL || 'http://localhost:3215';
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listing_url, email }),
    });
    if (!r.ok) throw new Error('Webhook error ' + r.status);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
