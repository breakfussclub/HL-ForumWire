# HLForumWire — Cross-Community Discord Bot

ForumWire monitors **TheColi** and **DapCity** (and any other XenForo forums) to post:
- 🆕 Only new threads (no reply spam)
- 🔥 Trending summaries (Top N threads every few hours)
- 🧭 Multi-feed, multi-channel support

---

## 🚀 Deploy to Railway

### 1. Prepare a Discord Bot
- Create a new app at https://discord.com/developers/applications
- Add a **Bot User**
- Enable **MESSAGE CONTENT INTENT**
- Copy the bot token → use as `DISCORD_TOKEN`

### 2. Add the bot to your server
Under OAuth2 → URL Generator:
- Scopes: `bot`, `applications.commands`
- Permissions: `Send Messages`, `Embed Links`
- Invite URL → select your server

### 3. Deploy
- Push this repo to GitHub.
- In Railway, create a new project from the repo.
- Add the following variables under **Settings → Variables**:

| Variable | Example Value | Description |
|-----------|----------------|-------------|
| `DISCORD_TOKEN` | `xyz...` | Your bot token |
| `COMMAND_GUILD_ID` | `1234567890` | Your Discord server ID |
| `NEWS_CHANNEL_ID` | `1234567890` | Default posting channel |
| `FEED_URLS` | `https://www.thecoli.com/forums/higher-learning.13/index.rss,https://dapcity.com/forums/general-discussion.5/index.rss` | Comma-separated feeds |
| `FEED_CHANNEL_MAP` | `{\"https://www.thecoli.com/forums/higher-learning.13/index.rss\":\"1234\",\"https://dapcity.com/forums/general-discussion.5/index.rss\":\"5678\"}` | Optional per-feed channel routing |
| `BOT_NAME` | `ForumWire` | Branding label in embeds |
| `DB_FILE` | `/data/forumwire.sqlite` | Persistent database file |
| `NEW_CHECK_MS` | `300000` | Check interval (5 min) |
| `ACTIVE_SUMMARY_MS` | `21600000` | Trending summary interval (6 hr) |
| `ACTIVE_SUMMARY_HOURS` | `24` | Activity window |
| `ACTIVE_SUMMARY_LIMIT` | `5` | Threads shown in trending list |

---

### 4. Start Command
Railway auto-detects the Procfile:
