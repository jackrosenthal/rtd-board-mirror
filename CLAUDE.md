# CLAUDE.md

This file provides guidance for AI assistants working on this codebase.

## Project Overview

This is a Cloudflare Worker that mirrors conversations from the RTD Board Collaboration Tool to a Slack channel. It runs on a cron schedule (every minute) and uses KV storage to track what has been mirrored.

## Key Files

- `src/index.ts` - Main worker code with all logic
- `wrangler.jsonc` - Cloudflare Worker configuration
- `worker-configuration.d.ts` - Auto-generated types (run `pnpm run cf-typegen` to regenerate)

## Commands

- `pnpm run dev` - Start local dev server
- `pnpm run deploy` - Deploy to Cloudflare
- `pnpm run cf-typegen` - Regenerate Cloudflare types after changing wrangler.jsonc
- `pnpm wrangler secret put <NAME>` - Set a secret
- `pnpm wrangler kv key list --namespace-id=<ID>` - List KV keys
- `pnpm wrangler tail` - Stream production logs

## Architecture

1. **Cron trigger** fires every minute
2. **Fetch RTD API** to get topics and replies
3. **For each topic**: Check KV, post to Slack if new, store thread_ts
4. **For each reply**: Check KV, post to thread if new
5. **Custom avatars** based on poster name from AVATAR_MAP

## Secrets Required

- `SLACK_BOT_TOKEN` - Slack bot token (xoxb-...)
- `SLACK_CHANNEL_ID` - Target Slack channel ID

## KV Schema

- `topic:{messageId}` → `{ slackThreadTs: string, lastMirroredAt: string }`
- `reply:{replyId}` → ISO timestamp string

## Testing

- Manual sync: `curl https://rtd-board-mirror.jrosenth.workers.dev/sync`
- Local dev: `pnpm run dev` then `curl http://localhost:8787/sync`

## Dependencies

- `html-to-mrkdwn-ts` - Converts HTML to Slack mrkdwn format
- Requires `nodejs_compat` compatibility flag for this dependency
