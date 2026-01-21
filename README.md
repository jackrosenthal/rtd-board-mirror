# RTD Board Mirror

A Cloudflare Worker that mirrors conversations from the RTD Board Collaboration Tool to Slack. Topics become threads, replies go into those threads, and custom avatars display based on board member names.

## Features

- Syncs every minute via cron trigger
- Each topic creates a new Slack message (thread parent)
- Replies post to the corresponding thread
- Custom avatars for RTD board directors
- Deduplication via KV storage
- HTML to Slack mrkdwn conversion

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create KV namespace

```bash
pnpm wrangler kv namespace create MIRROR_STATE
```

Update `wrangler.jsonc` with the returned namespace ID.

### 3. Configure Slack secrets

```bash
pnpm wrangler secret put SLACK_BOT_TOKEN
# Enter your bot token (xoxb-...)

pnpm wrangler secret put SLACK_CHANNEL_ID
# Enter the channel ID (e.g., C0A9GGTUM2B)
```

### 4. Slack App Requirements

Your Slack app needs these OAuth scopes:
- `chat:write` - Post messages
- `chat:write.customize` - Custom username and avatar

Invite the bot to your channel: `/invite @YourBotName`

### 5. Deploy

```bash
pnpm run deploy
```

## Development

Start local dev server:

```bash
pnpm run dev
```

Test sync manually:

```bash
curl http://localhost:8787/sync
```

View production logs:

```bash
pnpm wrangler tail
```

## API Endpoints

- `GET /` - Worker info and test instructions
- `GET /sync` - Manually trigger a sync (returns JSON with results)

## Configuration

The cron schedule is configured in `wrangler.jsonc`:

```jsonc
"triggers": {
  "crons": ["* * * * *"]  // Every minute
}
```

## Adding New Avatars

Edit the `AVATAR_MAP` in `src/index.ts` to add or update avatar URLs for board members.
