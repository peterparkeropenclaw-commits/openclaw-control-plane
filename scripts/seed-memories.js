'use strict';

const BASE_URL = process.env.CP_URL || 'http://localhost:3210';

const seedMemories = [
  // GLOBAL
  { scope: 'global', memory_type: 'rule', importance: 10, content: 'State lives in the Control Plane only. Never hold task state in an agent context window.' },
  { scope: 'global', memory_type: 'rule', importance: 10, content: 'PR titles must include [OC-{task_id}] for Reviewer Bot to auto-link.' },
  { scope: 'global', memory_type: 'rule', importance: 9, content: 'Never hardcode localhost or production URLs in code. Use NEXT_PUBLIC_APP_URL env var or relative /api/ paths.' },
  { scope: 'global', memory_type: 'decision', importance: 9, content: 'Discord removed from execution path entirely. Telegram only for escalation/notification.' },
  { scope: 'global', memory_type: 'decision', importance: 9, content: 'Permanent LLM agents retired except Peter. All workers are spawned per task and exit cleanly.' },
  { scope: 'global', memory_type: 'preference', importance: 8, content: 'Brandon prefers Claude Sonnet across all agents. Cost/performance balance is the priority.' },
  // BUILD
  { scope: 'build', memory_type: 'failure', importance: 8, content: 'Builder v2 previously nested new routes inside the /health handler causing them not to register at startup. Always add new Express routes at the top level, never inside existing route handlers.' },
  { scope: 'build', memory_type: 'failure', importance: 7, content: 'merge-worker was double-prefixing GITHUB_OWNER onto task.repo. task.repo already contains the full owner/repo string — never prepend owner again.' },
  { scope: 'build', memory_type: 'success', importance: 7, content: 'Subagent spawn proof completed in 49s, PR #34, clean exit. Subagent pattern confirmed working on review-responder repo.' },
  { scope: 'build', memory_type: 'pattern', importance: 8, content: 'Phase 2 Router (port 3220) is live and proven. All build tasks should be dispatched via Router → worker_registry, not direct to Builder v2.' },
  // REPLYWAVE
  { scope: 'replywave', memory_type: 'rule', importance: 10, content: 'Production URL is https://replywave.io. Never reference review-responder-hazel.vercel.app in any user-facing code.' },
  { scope: 'replywave', memory_type: 'rule', importance: 9, content: 'Design system: Bricolage Grotesque (headings, 700/800), Figtree (body, 300-600). Primary blue: #2d3de8. Logo: replywave.io lowercase, .io in blue.' },
  { scope: 'replywave', memory_type: 'rule', importance: 9, content: 'Buttons use border-radius: 100px (pill shape). No square buttons anywhere in the UI.' },
  { scope: 'replywave', memory_type: 'decision', importance: 8, content: 'No free trial. Paid plan only at £14.99/month. Never add free trial copy or CTAs.' },
  { scope: 'replywave', memory_type: 'context', importance: 8, content: 'Stack: Next.js 14, Supabase auth, Stripe £14.99/mo, OpenRouter/Claude, Resend, Vercel Pro. Repo: peterparkeropenclaw-commits/review-responder.' },
  // OPTILYST
  { scope: 'optilyst', memory_type: 'rule', importance: 9, content: 'Optilyst covers Etsy and eBay only. Pricing: $19/month founding, $29.99/month regular. USD only.' },
  { scope: 'optilyst', memory_type: 'rule', importance: 8, content: 'Design system: Fraunces serif headings, Instrument Sans body. Warm off-white bg (#faf8f4), forest green (#1e4535) primary, amber (#c4730a) CTAs.' },
  { scope: 'optilyst', memory_type: 'decision', importance: 8, content: 'Three pillars: Optimise + Grow (Pinterest/social) + Present (image optimisation). Discover pillar retired.' }
];

async function seed() {
  let ok = 0, fail = 0;
  for (const mem of seedMemories) {
    try {
      const res = await fetch(`${BASE_URL}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mem)
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[seed] ✓ id=${data.id} scope=${mem.scope} type=${mem.memory_type}`);
        ok++;
      } else {
        console.error(`[seed] ✗ ${res.status} ${await res.text()}`);
        fail++;
      }
    } catch (err) {
      console.error(`[seed] ✗ Error: ${err.message}`);
      fail++;
    }
  }
  console.log(`\n[seed] Done: ${ok} seeded, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

seed();
