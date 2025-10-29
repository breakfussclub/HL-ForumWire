import Parser from "rss-parser";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  Partials,
} from "discord.js";

// ===== Configuration =====
const parser = new Parser({ timeout: 20000 });
const FEED_URLS = (process.env.FEED_URLS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!FEED_URLS.length) throw new Error("FEED_URLS is required");

const FEED_CHANNEL_MAP = safeJSON(process.env.FEED_CHANNEL_MAP || "{}");
const BOT_NAME = process.env.BOT_NAME || "ForumWire";

const NEW_CHECK_MS = Number(process.env.NEW_CHECK_MS) || 300000; // 5 minutes
const ACTIVE_SUMMARY_MS =
  Number(process.env.ACTIVE_SUMMARY_MS) || 21600000; // 6 hours
const ACTIVE_SUMMARY_HOURS =
  Number(process.env.ACTIVE_SUMMARY_HOURS) || 24; // 24-hour window
const ACTIVE_SUMMARY_LIMIT =
  Number(process.env.ACTIVE_SUMMARY_LIMIT) || 5; // top N threads

const COLOR_NEW = 0x0077ff;
const COLOR_TRENDING = 0xffa500;

// ===== In-Memory Cache =====
const postedThreads = new Set();
const observations = [];

// ===== Discord Client =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

function safeJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

function normalize(link) {
  // remove /page-X and trailing slash
  return link.split("/page-")[0].replace(/\/$/, "");
}

function idFrom(link) {
  const m = link.match(/\.([0-9]+)/);
  return m ? m[1] : link;
}

// ===== Feed Logic =====
async function fetchFeed(url) {
  try {
    const feed = await parser.parseURL(url);
    for (const item of feed.items) {
      await processItem(item, url);
    }
  } catch (e) {
    console.error(`[Feed Error] ${url}:`, e.message || e);
  }
}

async function processItem(item, feedUrl) {
  const link = normalize(item.link);
  const id = idFrom(link);
  const title = item.title || "Untitled Thread";
  const now = Date.now();

  // record observation
  observations.push({ id, link, title, seen: now });

  // skip already-posted threads
  if (postedThreads.has(id)) return;

  const channelId = FEED_CHANNEL_MAP[feedUrl] || process.env.NEWS_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const color = feedUrl.includes("dapcity") ? 0xda4453 : COLOR_NEW;
  const source = feedUrl.includes("dapcity") ? "DapCity" : "TheColi";

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setURL(link)
    .setColor(color)
    .setFooter({ text: `${BOT_NAME} — ${source}` })
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
  postedThreads.add(id);
}

// ===== Trending Summary =====
async function postTrending() {
  const cutoff = Date.now() - ACTIVE_SUMMARY_HOURS * 3600 * 1000;

  // count thread appearances within timeframe
  const counts = {};
  for (const o of observations) {
    if (o.seen > cutoff) {
      counts[o.id] = counts[o.id] || { ...o, c: 0 };
      counts[o.id].c++;
    }
  }

  const sorted = Object.values(counts)
    .sort((a, b) => b.c - a.c)
    .slice(0, ACTIVE_SUMMARY_LIMIT);
  if (!sorted.length) return;

  const channelId = process.env.NEWS_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const desc = sorted
    .map((r, i) => `**${i + 1}.** [${r.title}](${r.link}) — ${r.c} updates`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`🔥 Most Active Threads (Past ${ACTIVE_SUMMARY_HOURS}h)`)
    .setDescription(desc)
    .setColor(COLOR_TRENDING)
    .setFooter({ text: BOT_NAME })
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}

// ===== Startup =====
client.once(Events.ClientReady, () => {
  console.log(`✅ ${BOT_NAME} logged in as ${client.user.tag}`);
  FEED_URLS.forEach((u, i) => {
    setTimeout(() => {
      fetchFeed(u);
      setInterval(() => fetchFeed(u), NEW_CHECK_MS);
    }, i * 5000);
  });
  setInterval(postTrending, ACTIVE_SUMMARY_MS);
});

client.login(process.env.DISCORD_TOKEN);
