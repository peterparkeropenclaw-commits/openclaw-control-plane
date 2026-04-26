# ENG-030: Telegram Exec Approvals

## What this changes

Added `channels.telegram.execApprovals` to `~/.openclaw/openclaw.json` on the Mac Mini gateway.

This routes all exec approval prompts to Brandon's personal Telegram DM (user ID `5821364140`) with Approve/Reject inline buttons. Covers all agents on the gateway.

## Config added to `~/.openclaw/openclaw.json`

```json
{
  "channels": {
    "telegram": {
      "execApprovals": {
        "enabled": true,
        "approvers": [5821364140],
        "target": "dm"
      }
    }
  }
}
```

Nested inside the existing `channels.telegram` block (after `defaultAccount`).

## How it works

- `enabled: true` — Telegram acts as an exec approval client
- `approvers: [5821364140]` — only Brandon can approve/deny (his personal Telegram ID)
- `target: "dm"` — prompts go to Brandon's DM, not a group chat

When an exec approval is required, Brandon receives a Telegram DM with the command and inline Approve/Reject buttons. He can also reply `/approve <id> allow-once|allow-always|deny`.

## Activation

**Gateway restart required** — run after reviewing this PR:

```bash
openclaw gateway restart
```

Brandon to confirm timing before restart. Change is live the moment gateway restarts.

## Notes

- Bot token is already configured in `openclaw.json` under `channels.telegram.botToken`
- This applies to **all agents** on the Mac Mini gateway — no per-agent filter set
- Mission Control chat (`-5085897499`) is NOT used for approvals — Brandon's personal DM only
- To scope to specific agents later: add `agentFilter: ["engineering-lead"]` etc.
