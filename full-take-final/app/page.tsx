"use client";
import React, { useEffect, useState } from "react";

const NAVY = "#0A1628";
const GOLD = "#E8C840";
const ALT_BG = "#F7F8FA";

const rotating = [
  "Your Airbnb listing. Audited.",
  "More bookings.",
  "Higher rates.",
  "Less guesswork.",
];

export default function HomePage() {
  const [idx, setIdx] = useState(0);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    let mounted = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const t = setInterval(() => {
      if (!mounted) return;
      setOpacity(0);
      setTimeout(() => {
        setIdx((i) => (i + 1) % rotating.length);
        setOpacity(1);
      }, 500);
    }, 3500);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div>
      <nav style={{position:'fixed',top:0,left:0,right:0,zIndex:50,background:'#fff',borderBottom:'1px solid rgba(0,0,0,0.06)',padding:'14px 24px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <a href="/" style={{display:'flex',alignItems:'center',gap:12,textDecoration:'none'}}>
          <img src="/strclinic-logo.svg" alt="STR Clinic" style={{height:36,width:36,borderRadius:6}}/>
          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,color:NAVY,fontSize:20}}>STR Clinic</span>
        </a>
        <a href="#audit-form" style={{background:GOLD,color:NAVY,borderRadius:100,padding:'10px 22px',textDecoration:'none',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,boxShadow:'0 4px 16px rgba(232,200,64,0.35)'}}>Get Your Free Audit</a>
      </nav>

      {/* Section 1 - Hero */}
      <section style={{background:'#fff',paddingTop:96,paddingBottom:64}}>
        <div style={{maxWidth:1200,margin:'0 auto',display:'grid',gridTemplateColumns:'1fr 360px',gap:40,alignItems:'center',padding:'0 24px'}}>

          <div>
            <span style={{display:'inline-block',background:'#E8C840',color:'#0A1628',fontSize:'12px',fontWeight:700,letterSpacing:'1px',textTransform:'uppercase',padding:'4px 14px',borderRadius:'100px',marginBottom:'16px'}}>FREE — No account required</span>
            <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:80,lineHeight:1,color:NAVY,margin:0,marginBottom:18}}>
              <span style={{display:'inline-block',transition:'opacity 500ms'}} aria-live="polite">{rotating[idx]}</span>
            </h1>
            <p style={{fontSize:22,color:'#222',marginTop:6,marginBottom:22}}>Free, instant PDF audit of your listing — score, one quick win, and a revenue estimate.</p>
            <div style={{display:'flex',gap:'20px',flexWrap:'wrap',fontSize:'13px',color:'#666',marginTop:'12px',marginBottom:'8px'}}>
              <span>⚡ Instant PDF</span><span>✓ No login</span><span>🔒 Your data is private</span>
            </div>
            <div id="audit-form" style={{marginTop:18}}>
              <AuditForm />
            </div>
          </div>

          <div style={{justifySelf:'end'}}>
            <div style={{background:'#fff', border:'1px solid #e0e0e0', borderTop:'4px solid '+GOLD, borderRadius:8, padding:24, boxShadow:'0 4px 24px rgba(0,0,0,0.10)', maxWidth:340, fontFamily:'IBM Plex Mono, monospace', fontSize:12}}>
              <div style={{fontSize:10, letterSpacing:2, color:'#888', marginBottom:8}}>STR CLINIC AUDIT</div>
              <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:16}}>
                <div style={{width:56, height:56, borderRadius:'50%', background:NAVY, color:GOLD, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize:18}}>6.8</div>
                <div style={{fontSize:11, color:'#333'}}>out of 10<br/><span style={{color:'#888'}}>Overall score</span></div>
              </div>

              {([['Title','72%'],['Photos','58%'],['Description','81%'],['Pricing','64%'],['Reviews','89%']] as [string,string][]).map(([label,pct])=> (
                <div key={label} style={{marginBottom:6}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#555',marginBottom:4}}><span>{label}</span><span>{pct}</span></div>
                  <div style={{height:4,background:'#f0f0f0',borderRadius:2}}><div style={{height:4,background:GOLD,borderRadius:2,width:pct}}/></div>
                </div>
              ))}

              <div style={{marginTop:16,padding:10,background:ALT_BG,borderRadius:4,fontSize:10}}>
                <div style={{fontWeight:700,color:NAVY,marginBottom:4}}>⚡ QUICK WIN</div>
                <div style={{color:'#555'}}>Add "fast Wi-Fi" and "free parking" to your title — these are top searched terms in your area.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2 - How it works */}
      <section style={{background:ALT_BG,padding:'56px 0'}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'0 24px',textAlign:'center'}}>
          <h2 style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:48,color:NAVY,marginBottom:28}}>How it works — 3 easy steps</h2>
          <div style={{display:'flex',gap:20,justifyContent:'center',flexWrap:'wrap'}}>
            {[{
              n:'1',title:'Submit your listing URL',body:"Paste your Airbnb or Vrbo link — we only need the URL and an email."},
              {n:'2',title:'Get an instant PDF audit',body:"You'll receive a scored audit (PDF) by email — no login required."},
              {n:'3',title:'Upgrade to the Full Clinic (£199)',body:"When you're ready, buy the full report with paste-ready copy and a 12‑month pricing plan."}
            ].map(s=> (
              <div key={s.n} style={{background:'#fff',padding:20,borderRadius:8,width:280,boxShadow:'0 6px 18px rgba(0,0,0,0.04)'}}>
                <div style={{width:48,height:48,borderRadius:24,background:GOLD,color:NAVY,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:900,fontFamily:"'Barlow Condensed',sans-serif",marginBottom:12}}>{s.n}</div>
                <div style={{fontWeight:700,color:NAVY,marginBottom:6}}>{s.title}</div>
                <div style={{color:'#555',fontSize:15}}>{s.body}</div>
                {s.n==='1' && <div style={{fontSize:'12px',color:GOLD,fontStyle:'italic',marginTop:6}}>→ Takes 30 seconds</div>}
                {s.n==='2' && <div style={{fontSize:'12px',color:GOLD,fontStyle:'italic',marginTop:6}}>→ Arrives in ~1–5 minutes</div>}
                {s.n==='3' && <div style={{fontSize:'12px',color:GOLD,fontStyle:'italic',marginTop:6}}>→ Delivered within 48 hours</div>}
              </div>
            ))}
          </div>
          <div style={{marginTop:28}}>
            <a href="#audit-form" style={{background:GOLD,color:NAVY,borderRadius:100,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,textTransform:'uppercase',padding:'14px 36px',border:'none',fontSize:'1.1rem',cursor:'pointer',display:'inline-block',textDecoration:'none',marginRight:12,boxShadow:'0 4px 16px rgba(232,200,64,0.35)'}}>Get Your Free Audit</a>
            <a href="/buy" style={{background:'transparent',color:NAVY,border:`2px solid ${NAVY}`,borderRadius:100,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,textTransform:'uppercase',padding:'14px 36px',fontSize:'1.1rem',cursor:'pointer',display:'inline-block',textDecoration:'none'}}>Buy Full Clinic — £199</a>
          </div>
        </div>
      </section>

      {/* Section 3 - What you get */}
      <section style={{background:'#fff',padding:'56px 0'}}>
        <div style={{maxWidth:1200,margin:'0 auto',display:'grid',gridTemplateColumns:'1fr 1fr',gap:32,padding:'0 24px',alignItems:'start'}}>
          {/* Free column */}
          <div style={{background:ALT_BG,border:'1px solid rgba(10,22,40,0.04)',borderRadius:8,padding:24}}>
            <h3 style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:40,color:NAVY,margin:0}}>Free Audit</h3>
            <div style={{color:'#444',marginTop:6,fontWeight:700,fontSize:15}}>Instant PDF — no login</div>
            <ul style={{marginTop:14,lineHeight:1.8,color:'#333',paddingLeft:18}}>
              <li style={{marginBottom:8}}>✓ Overall score out of 10 (5 pillars)</li>
              <li style={{marginBottom:8}}>✓ Scored bars per pillar</li>
              <li style={{marginBottom:8}}>✓ AI insight for every pillar</li>
              <li style={{marginBottom:8}}>✓ One quick win to implement today</li>
              <li style={{marginBottom:8}}>✓ Revenue-impact estimate</li>
              <li style={{marginBottom:8}}>✓ Brandon's personal note</li>
              <li style={{marginBottom:8}}>✓ PDF by email in ~1–5 minutes</li>
            </ul>

            <div style={{marginTop:16}}>
              <a href="#audit-form" style={{background:GOLD,color:NAVY,borderRadius:100,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,textTransform:'uppercase',padding:'12px 22px',border:'none',fontSize:'0.95rem',cursor:'pointer',display:'inline-block',textDecoration:'none',boxShadow:'0 4px 12px rgba(232,200,64,0.25)'}}>Get Free Audit →</a>
            </div>
          </div>

          {/* Paid column */}
          <div style={{background:NAVY,color:'#fff',borderTop:`3px solid ${GOLD}`,borderRadius:8,padding:20,position:'relative',boxShadow:'0 8px 40px rgba(232,200,64,0.15)'}}>
            <div style={{position:'absolute',top:12,right:12,background:GOLD,color:NAVY,padding:'6px 10px',borderRadius:6,fontWeight:900,fontSize:11}}>MOST POPULAR</div>
            <h3 style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:40,color:GOLD,marginTop:6,marginBottom:2}}>Full Clinic</h3>
            <div style={{color:'rgba(255,255,255,0.8)',marginBottom:12,fontWeight:700}}>£199 one-off</div>

            <ul style={{marginTop:6,lineHeight:1.8,color:'#fff',paddingLeft:18}}>
              <li style={{marginBottom:8}}>✓ Everything in the free audit</li>
              <li style={{marginBottom:8}}>★ Rewritten title & description — paste-ready</li>
              <li style={{marginBottom:8}}>★ Photo order plan with rationale</li>
              <li style={{marginBottom:8}}>★ 12-month pricing calendar</li>
              <li style={{marginBottom:8}}>★ Competitor analysis & revenue impact table</li>
              <li style={{marginBottom:8}}>★ Guest communication templates</li>
              <li style={{marginBottom:8}}>★ Platform expansion guide (Vrbo, Booking.com)</li>
              <li style={{marginBottom:8}}>★ 3-step growth plan</li>
            </ul>

            <div style={{marginTop:18,display:'flex',flexDirection:'column',gap:12,alignItems:'flex-start'}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:44,color:GOLD}}>£199</div>
              <a href="/buy" style={{background:GOLD,color:NAVY,borderRadius:100,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,textTransform:'uppercase',padding:'12px 22px',border:'none',fontSize:'0.95rem',cursor:'pointer',textDecoration:'none',boxShadow:'0 6px 20px rgba(10,22,40,0.12)'}}>Buy Full Clinic — £199</a>
              <div style={{fontSize:12,opacity:0.85,fontStyle:'italic',marginTop:6}}>Brandon reviews every paid clinic personally</div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4 - PDF mock band */}
      <section style={{background:'#fff',padding:'56px 0'}}>
        <div style={{maxWidth:1200,margin:'0 auto',display:'grid',gridTemplateColumns:'1fr 1fr',gap:24,padding:'0 24px',alignItems:'center'}}>
          <div>
            <div style={{width:'100%',maxWidth:520,background:'#fff',border:'1px solid #e6e6e6',borderRadius:6,overflow:'hidden'}}>
              <div style={{background:NAVY,color:GOLD,padding:12,fontWeight:900}}>STR CLINIC</div>
              <div style={{padding:16}}>
                <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:12}}>
                  <div style={{width:60,height:60,borderRadius:30,background:NAVY,color:GOLD,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:900}}>6.8</div>
                  <div>
                    <div style={{fontSize:14,fontWeight:700}}>Overall score</div>
                    <div style={{fontSize:12,color:'#666'}}>Out of 10 — weighted across five pillars</div>
                  </div>
                </div>
                <div style={{marginTop:8}}>
                  {(['Title','Photos','Description','Pricing','Reviews'] as string[]).map((p,i)=> (
                    <div key={p} style={{marginBottom:8}}>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#333'}}><span>{p}</span><span>{["72%","58%","81%","64%","89%"][i]}</span></div>
                      <div style={{height:6,background:'#f0f0f0',borderRadius:4}}><div style={{height:6,background:GOLD,width:["72%","58%","81%","64%","89%"][i],borderRadius:4}}/></div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:12,padding:12,background:ALT_BG,borderRadius:6}}>
                  <div style={{fontWeight:700}}>⚡ QUICK WIN</div>
                  <div style={{color:'#333'}}>Add fast Wi‑Fi and free parking to your title.</div>
                </div>
                <div style={{marginTop:12,padding:12,background:'#fff',borderRadius:6,borderTop:`3px solid ${GOLD}`}}>
                  <div style={{fontWeight:700}}>Revenue estimate</div>
                  <div style={{color:'#333'}}>Estimated uplift: £120–£420 / month</div>
                </div>
                <div style={{marginTop:14}}>
                  <a href="/buy" style={{background:GOLD,color:NAVY,borderRadius:100,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,textTransform:'uppercase',padding:'10px 22px',border:'none',fontSize:'0.95rem',cursor:'pointer',display:'inline-block',textDecoration:'none',boxShadow:'0 4px 16px rgba(232,200,64,0.35)'}}>Upgrade to Full Clinic</a>
                </div>
              </div>
            </div>
          </div>

          <div>
            <ul style={{lineHeight:1.8,color:'#333'}}>
              <li><strong>Cover:</strong> Score, key metrics, Brandon's note</li>
              <li><strong>Pillar bars:</strong> visual score across 5 pillars</li>
              <li><strong>AI insight cards:</strong> concrete note + reason</li>
              <li><strong>Quick win:</strong> one action to increase bookings</li>
              <li><strong>Revenue estimate:</strong> monthly impact band</li>
              <li><strong>Upgrade CTA:</strong> link to Full Clinic</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Section 5 - Social proof (Before/After + Testimonials) — updated 2026-04-11 */}
      <section style={{background:NAVY,color:'#fff',padding:'64px 0'}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'0 24px'}}>
          <h2 style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:48,color:'#fff',marginBottom:8,textAlign:'center'}}>Before → After: copy that converts</h2>
          <p style={{maxWidth:820,margin:'0 auto 24px',fontSize:16,opacity:0.95,lineHeight:1.5,textAlign:'center'}}>A small rewrite can make your listing visible and irresistible. Below: a concrete before/after example, plus real host results.</p>

          {/* Before / After block */}
          <div style={{display:'flex',gap:16,justifyContent:'center',flexWrap:'wrap',marginTop:12}}>
            <div style={{width:520,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={{background:'rgba(255,255,255,0.04)',padding:18,borderRadius:8,border:'1px solid rgba(255,255,255,0.06)'}}>
                <div style={{fontSize:12,color:'#bfc8d6',fontWeight:700,marginBottom:8}}>Before</div>
                <div style={{background:'transparent',padding:12,borderRadius:6,color:'#d6dbe3',fontSize:20,fontWeight:700,minHeight:64,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  Cosy countryside retreat — perfect for couples
                </div>
                <div style={{fontSize:12,color:'#bfc8d6',marginTop:10,textAlign:'center'}}>Muted, adjective-led, hard to find in searches</div>
              </div>

              <div style={{background:'#071126',padding:18,borderRadius:8,border:`2px solid ${GOLD}`,boxShadow:'0 8px 30px rgba(232,200,64,0.12)'}}>
                <div style={{fontSize:12,color:GOLD,fontWeight:700,marginBottom:8}}>After</div>
                <div style={{background:'transparent',padding:12,borderRadius:6,color:'#fff',fontSize:20,fontWeight:900,minHeight:64,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  Hot Tub Cabin · 35 min from Bath · Private Garden & Log Burner
                </div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.85)',marginTop:10,textAlign:'center'}}>Search-friendly, benefit-led, and conversion-focused</div>
              </div>

              <div style={{gridColumn:'1 / span 2',textAlign:'center',marginTop:8,color:'rgba(255,255,255,0.85)',fontSize:13}}>This change alone can lift click-through rate by 20–40%</div>
            </div>
          </div>

          {/* Testimonials */}
          <div style={{display:'flex',gap:16,justifyContent:'center',marginTop:36,flexWrap:'wrap'}}>
            {[
              {t:"Went from 40% to 78% occupancy in 6 weeks. The pricing section alone was worth £199.", n:'James T., Lake District'},
              {t:"Brandon rewrote my title and description. First week after: 3 new bookings.", n:'Sarah M., Cornwall'},
              {t:"I'd been stuck at 3.8 stars for months. The photo order change fixed it.", n:'Priya K., Edinburgh'},
            ].map((c,i)=> (
              <div key={i} style={{background:'rgba(255,255,255,0.03)',padding:20,borderRadius:8,border:`1px solid rgba(255,255,255,0.06)`,width:320,display:'flex',gap:12}}>
                <div style={{width:6,background:GOLD,borderRadius:2}} />
                <div style={{flex:1}}>
                  <div style={{color:'#fff',fontSize:15,fontWeight:700,marginBottom:8,fontStyle:'italic'}}>{`"${c.t}"`}</div>
                  <div style={{color:GOLD,fontSize:13,fontWeight:700}}>{c.n}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{marginTop:28,textAlign:'center',color:GOLD,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:22}}>Real hosts. Real lifts. Real, specific recommendations.</div>
        </div>
      </section>

      {/* Section 6 - Brandon About section */}
      <section id="about" style={{background:'#fff',padding:'96px 0'}}>
        <div style={{maxWidth:1200,margin:'0 auto',display:'grid',gridTemplateColumns:'1fr 1fr',gap:40,alignItems:'center',padding:'0 24px'}}>
          {/* Photo placeholder */}
          <div style={{display:'flex',justifyContent:'center'}}>
            <div style={{width:160,height:160,borderRadius:160/2,background:NAVY,border:`3px solid ${GOLD}`,display:'flex',alignItems:'center',justifyContent:'center'}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,color:GOLD,fontSize:48,letterSpacing:1}}>BC</div>
            </div>
          </div>

          {/* Bio text */}
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,letterSpacing:1, textTransform:'uppercase',color:GOLD,marginBottom:10}}>ABOUT BRANDON</div>
            <h2 style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:36, textTransform:'uppercase',color:NAVY,margin:0,marginBottom:12}}>Host-to-host. No agency.</h2>
            <p style={{fontFamily:"Inter, system-ui, sans-serif",fontSize:16,color:'rgba(10,22,40,0.8)',marginTop:6,marginBottom:18,lineHeight:1.6}}>Brandon has managed short-term rentals for over a decade — not as an agency, but as a host. Every STR Clinic audit is written by him personally, based on what actually moves bookings: stronger copy, smarter pricing, and a listing algorithm can actually find.</p>

            <div style={{display:'flex',gap:12,marginBottom:14}}>
              {['10+ years hosting','500+ audits','Avg. +£200/mo uplift'].map((s,i)=> (
                <div key={i} style={{background:NAVY,color:GOLD,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,padding:'8px 12px',borderRadius:6,fontSize:14}}>{s}</div>
              ))}
            </div>

            <div style={{fontSize:14,color:'rgba(10,22,40,0.6)'}}>Questions? <a href="mailto:brandon@strclinic.com" style={{color:'rgba(10,22,40,0.8)',textDecoration:'underline'}}>brandon@strclinic.com</a></div>
          </div>
        </div>
      </section>

      {/* Section 7 - FAQ */}
      <section id="faq" style={{background:ALT_BG,padding:'48px 0'}}>
        <div style={{maxWidth:920,margin:'0 auto',padding:'0 24px'}}>
          <h3 style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:32,color:NAVY,marginBottom:18}}>FAQ</h3>
          <div>
            {/* faqItems is defined below */}
            <Accordion items={faqItems} />
          </div>
        </div>
      </section>

      {/* Section 8 - Footer */}
      <footer style={{background:NAVY,color:'#fff',padding:'28px 0',textAlign:'center'}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'0 24px'}}>
          <div style={{fontSize:18,fontWeight:700}}>Brandon — STR Clinic</div>
          <div style={{marginTop:6,opacity:0.9}}>I review every paid clinic personally.</div>
          <div style={{marginTop:12}}>
            <a href="#audit-form" style={{background:GOLD,color:NAVY,borderRadius:100,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,textTransform:'uppercase',padding:'10px 22px',border:'none',fontSize:'0.95rem',cursor:'pointer',display:'inline-block',textDecoration:'none'}}>Get Your Free Audit</a>
          </div>
          <div style={{marginTop:12,fontSize:13,opacity:0.9}}> <a href="#" style={{color:'#fff',opacity:0.9}}>Privacy</a> · <a href="#" style={{color:'#fff',opacity:0.9}}>Terms</a> · <a href="#" style={{color:'#fff',opacity:0.9}}>Contact</a></div>
        </div>
      </footer>
    </div>
  );
}

function AuditForm(){
  const [listing_url,setListingUrl]=useState("");
  const [email,setEmail]=useState("");
  const [loading,setLoading]=useState(false);
  const [success,setSuccess]=useState("");
  const [error,setError]=useState("");
  const [fieldErrors,setFieldErrors]=useState<{listing?:string,email?:string}>({});

  const submit = async (e:React.FormEvent)=>{
    e.preventDefault();
    setError("");
    setSuccess("");
    setFieldErrors({});
    if(!/airbnb\.|vrbo\./i.test(listing_url)) return setFieldErrors({listing:'Please provide a valid Airbnb or Vrbo URL.'});
    if(!/\S+@\S+\.\S+/.test(email)) return setFieldErrors({email:'Please provide a valid email.'});
    setLoading(true);
    try{
      const r = await fetch('/api/free-audit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({listing_url,email})});
      const j = await r.json();
      if(!r.ok) throw new Error(j.error||'Unknown');
      setSuccess("We've queued your audit — check your email in ~1–5 minutes.");
      setListingUrl(''); setEmail('');
    }catch(e:any){
      setError('Something went wrong — please try again or email us at audit@strclinic.com');
    }finally{setLoading(false)}
  }

  const inputBase:React.CSSProperties = {width:'100%',padding:'12px 14px',minHeight:48,fontSize:16,boxSizing:'border-box',borderRadius:12,border:`1px solid rgba(10,22,40,0.12)`,color:'#072233',outline:'none'};
  const labelStyle:React.CSSProperties = {fontSize:13,fontWeight:700,marginBottom:6,display:'block'};

  return (
    <form onSubmit={submit} style={{marginTop:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,alignItems:'start'}}>
      <div style={{gridColumn:'1 / span 2'}}>
        <label style={{textAlign:'left',display:'block'}}>
          <div style={labelStyle}>Listing URL</div>
          <input
            value={listing_url}
            onChange={e=>setListingUrl(e.target.value)}
            placeholder="https://www.airbnb.com/rooms/12345678"
            type="url"
            inputMode="url"
            aria-label="Listing URL"
            style={{...inputBase, border: fieldErrors.listing ? '1px solid #b71c1c' : inputBase.border, background:'#fff', color:'#072233'}}
          />
          {fieldErrors.listing && <div style={{color:'#9b1c1c',fontSize:13,marginTop:8}}>{fieldErrors.listing}</div>}
        </label>
      </div>

      <label style={{gridColumn:'1 / span 1',textAlign:'left',display:'block'}}>
        <div style={labelStyle}>Email</div>
        <input
          value={email}
          onChange={e=>setEmail(e.target.value)}
          placeholder="you@your-email.com"
          type="email"
          inputMode="email"
          aria-label="Email"
          style={{...inputBase, border: fieldErrors.email ? '1px solid #b71c1c' : inputBase.border, background:'#fff'}}
        />
        {fieldErrors.email && <div style={{color:'#9b1c1c',fontSize:13,marginTop:8}}>{fieldErrors.email}</div>}
      </label>

      <div style={{gridColumn:'2 / span 1',display:'flex',alignItems:'end',justifyContent:'flex-end'}}>
        <button
          type="submit"
          disabled={loading}
          style={{
            background: GOLD,
            color: NAVY,
            borderRadius:100,
            fontFamily:"'Barlow Condensed',sans-serif",
            fontWeight:900,
            textTransform:'uppercase',
            padding:'12px 22px',
            border:'none',
            fontSize:16,
            cursor:'pointer',
            boxShadow:'0 6px 20px rgba(10,22,40,0.12)',
            minHeight:52,
            width:'100%'
          }}
        >
          {loading ? 'Generating your audit...' : 'Get my free audit'}
        </button>
      </div>

      <div style={{gridColumn:'1 / span 2',marginTop:8}}>
        {success && (
          <div style={{display:'flex',alignItems:'center',gap:12,background:'#081226',color:GOLD,padding:14,borderRadius:12}}>
            <div style={{width:36,height:36,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:999,background:GOLD,color:NAVY,fontWeight:900}}>✓</div>
            <div>
              <div style={{fontWeight:800}}>Success</div>
              <div style={{fontSize:13,color:'rgba(232,200,64,0.95)'}}>{success}</div>
            </div>
          </div>
        )}

        {error && (
          <div style={{background:'#fff6f6',border:'1px solid #f5c2c2',padding:12,borderRadius:8,color:'#6b1212'}}>{error}</div>
        )}

        <div style={{fontSize:12,color:'#888',marginTop:8}}>We only use your URL and email to build the audit. We never list or contact guests.</div>
      </div>

      {/* Focus ring styles via inline event handlers */}
      <style>{`
        input:focus{ box-shadow: 0 0 0 4px rgba(232,200,64,0.15); border-color: ${GOLD}; }
        input::placeholder{ color: rgba(10,22,40,0.35); }
        @media (max-width:700px){
          form { grid-template-columns: 1fr !important; }
          div[style*="gridColumn:'2 / span 1'"] button{ width:100% !important; }
        }
      `}</style>
    </form>
  )
}

import Accordion from './components/Accordion';

const faqItems = [
  {q:'How fast is the free audit?', a:"Instant — you'll get a PDF by email within a few minutes."},
  {q:'What do you need from me?', a:'Only the listing URL and an email. No calendar access, no passwords.'},
  {q:'Is my listing data private?', a:'Yes. We never contact your guests or publish your listing.'},
  {q:'How long until I get the paid report?', a:"Within 48 hours; most arrive faster. Brandon reviews each one personally."},
  {q:'Can I use this for Vrbo or Booking.com listings?', a:"We support Airbnb and Vrbo URLs. If your listing is on Booking.com or another platform, get in touch — we can still run a manual audit."},
  {q:'What if my listing isn\'t on Airbnb?', a:"We support Airbnb and Vrbo URLs. If your listing is on Booking.com or another platform, get in touch — we can still run a manual audit."},
  {q:'Is there a money-back guarantee?', a:"If your audit doesn't arrive within 24 hours, we'll refund you in full. No questions asked."},
];