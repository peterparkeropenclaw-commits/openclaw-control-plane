import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const size = {
  width: 1200,
  height: 630,
};

export default function handler() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%',
        height: '100%',
        background: '#0A1628',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontFamily: 'Barlow Condensed, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
      }}>
        {/* gold top bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: '#E8C840' }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, padding: 48, textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 12, height: 12, background: '#E8C840' }} />
            <div style={{ fontWeight: 900, fontSize: 24, letterSpacing: '0.2em' }}>
              STR CLINIC
            </div>
          </div>

          <div style={{ fontWeight: 900, fontSize: 72, lineHeight: 1.03 }}>
            Free Airbnb Listing Audit
          </div>

          <div style={{ fontWeight: 600, fontSize: 28, opacity: 0.85 }}>
            Scored PDF · Instant · No login required
          </div>
        </div>

        <div style={{ position: 'absolute', bottom: 36 }}>
          <div style={{ background: '#E8C840', color: '#0A1628', padding: '10px 18px', borderRadius: 999, fontWeight: 700, fontSize: 18 }}>
            strclinic.com
          </div>
        </div>
      </div>
    ),
    {
      width: size.width,
      height: size.height,
    }
  );
}
