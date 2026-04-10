#!/usr/bin/env python3.11
"""
ENG-023: Browser Use calendar occupancy scraper for STR Clinic.
Accepts a single Airbnb listing URL as CLI arg.
Outputs JSON to stdout: {"occupancy": 72, "booked_days": 65, "available_days": 25}
On failure: {"occupancy": null, "error": "<message>"}
Always exits 0.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

# Load ANTHROPIC_API_KEY from zshrc if not in env
if not os.environ.get('ANTHROPIC_API_KEY'):
    zshrc = Path.home() / '.zshrc'
    if zshrc.exists():
        for line in zshrc.read_text().splitlines():
            if line.startswith('export ANTHROPIC_API_KEY='):
                os.environ['ANTHROPIC_API_KEY'] = line.split('=', 1)[1].strip()
                break

def fail(msg):
    print(json.dumps({"occupancy": None, "error": msg}))
    sys.exit(0)

if len(sys.argv) < 2:
    fail("No listing URL provided")

listing_url = sys.argv[1]

try:
    from browser_use import Agent, BrowserConfig, Browser
    from langchain_anthropic import ChatAnthropic
except ImportError as e:
    fail(f"Import error: {e}")

task_prompt = f"""Go to this Airbnb listing: {listing_url}

Open the availability calendar on the listing page. Count the number of days that are marked as booked/unavailable (greyed out, crossed out, or otherwise not selectable) across the next 90 days from today. Also count available days.

Return ONLY a JSON object with no other text:
{{"booked_days": <integer>, "available_days": <integer>, "occupancy": <integer 0-100>}}

occupancy = round(booked_days / 90 * 100)"""

async def run():
    try:
        llm = ChatAnthropic(model="claude-haiku-4-5-20251001", timeout=90, stop=None)
        browser = Browser(config=BrowserConfig(headless=True))
        agent = Agent(task=task_prompt, llm=llm, browser=browser)
        result = await asyncio.wait_for(agent.run(), timeout=90)

        # Extract the final message text
        raw = None
        if hasattr(result, 'final_result'):
            raw = result.final_result()
        elif hasattr(result, 'history') and result.history:
            raw = str(result.history[-1])
        else:
            raw = str(result)

        # Find JSON in the output
        import re
        match = re.search(r'\{[^{}]*"booked_days"[^{}]*\}', raw, re.DOTALL)
        if not match:
            fail(f"No JSON found in agent output: {raw[:300]}")
            return

        data = json.loads(match.group(0))
        booked = int(data.get('booked_days', 0))
        available = int(data.get('available_days', 0))
        occupancy = int(data.get('occupancy', round(booked / 90 * 100)))
        occupancy = max(0, min(100, occupancy))

        print(json.dumps({"occupancy": occupancy, "booked_days": booked, "available_days": available}))

    except asyncio.TimeoutError:
        fail("Browser Use timed out after 90s")
    except Exception as e:
        fail(str(e))

asyncio.run(run())
