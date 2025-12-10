---
title: Tg Poster
emoji: 🚀
colorFrom: pink
colorTo: red
sdk: docker
pinned: false
---

Check out the configuration reference at https://huggingface.co/docs/hub/spaces-config-reference


# Telegram Poster Bot

A bot that reads messages from public Telegram channels and reposts them to your own channel.

## Features

- 📡 Scrapes public Telegram channels (no API credentials needed for reading!)
- 📤 Posts to your channel via Bot API
- 🖼️ Supports text, images, and videos
- ⏰ Configurable cron schedule
- 🐳 Docker-ready for Hugging Face Spaces

## Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token

### 2. Get Your Channel ID

1. Add your bot as an **admin** to your channel
2. Forward a message from your channel to [@userinfobot](https://t.me/userinfobot)
3. The channel ID looks like `-100xxxxxxxxxx`

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
BOT_TOKEN=your_bot_token_here
CHANNEL_ID=-100xxxxxxxxxx
SOURCE_CHANNELS=durov,telegram
```

### 4. Run Locally

```bash
bun install
bun run dev
```

### 5. Deploy to Hugging Face

1. Create a new Space on [Hugging Face](https://huggingface.co/spaces)
2. Select **Docker** as the SDK
3. Push your code:
   ```bash
   git add .
   git commit -m "Initial commit"
   git push
   ```
4. Add secrets in Space settings:
   - `BOT_TOKEN`
   - `CHANNEL_ID`
   - `SOURCE_CHANNELS`

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `BOT_TOKEN` | Telegram bot token (required) | - |
| `CHANNEL_ID` | Target channel ID (required) | - |
| `SOURCE_CHANNELS` | Channels to monitor, comma-separated | - |
| `CRON_SCHEDULE` | Cron expression for checks | `*/5 * * * *` |
| `INCLUDE_SOURCE` | Add "from @channel" to posts | `true` |

## How It Works

1. The bot scrapes the public web preview at `t.me/s/CHANNELNAME`
2. Extracts messages, images, and videos
3. Posts new content to your channel
4. Tracks last processed message to avoid duplicates

## License

MIT