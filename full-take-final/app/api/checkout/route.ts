import Stripe from 'stripe';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { listing_url, email } = body || {};
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe key not configured' }, { status: 500 });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2022-11-15' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: { name: 'STR Clinic Full Report' },
            unit_amount: 19900,
          },
          quantity: 1,
        },
      ],
      success_url: 'https://strclinic.com/thank-you?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://strclinic.com/buy',
      customer_email: email,
      metadata: { listing_url: listing_url || '', email: email || '' },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
