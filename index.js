import Parser from "rss-parser";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  Events,
  Partials,
  SlashCommandBuilder,
} from "discord.js";
import fs from "fs";

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

// ===== Persistent Cache (JSON) =====
const CACHE_FILE = "./postedThreads.json";
let postedThreads = new Set();
try {
  if (fs.existsSync(CACHE_FILE)) {
    postedThreads = new Set(JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")));
    console.log(`🗂️ Loaded ${postedThreads.size} cached thread IDs`);
  }
} catch (err) {
  console.error("⚠️ Failed to load cache file:", err);
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify([...postedThreads]));
  } catch (err) {
    console.error("⚠️ Failed to save cache:", err);
  }
}

// ===== In-Memory Observations (for trending) =====
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

  // Skip old threads (ignore anything older than 6 hours on first run)
  const maxAgeMs = 6 * 60 * 60 * 1000; // 6 hours
  const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : null;
  if (pubDate && now - pubDate > maxAgeMs && !postedThreads.size) {
    // Only skip on first run (when cache is empty)
    return;
  }

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
  console.log(`[NEW] Posted from ${source}: ${title}`);
  postedThreads.add(id);
  saveCache(); // persist immediately
}

// ===== Trending Summary =====
async function postTrending(channelOverride = null, ephemeral = false, interaction = null) {
  const cutoff = Date.now() - ACTIVE_SUMMARY_HOURS * 3600 * 1000;

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
  if (!sorted.length) {
    if (interaction)
      await interaction.reply({
        content: "No activity recorded in the last 24h.",
        ephemeral: true,
      });
    return;
  }

  const desc = sorted
    .map((r, i) => `**${i + 1}.** [${r.title}](${r.link}) — ${r.c} updates`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`🔥 Most Active Threads (Past ${ACTIVE_SUMMARY_HOURS}h)`)
    .setDescription(desc)
    .setColor(COLOR_TRENDING)
    .setFooter({ text: BOT_NAME })
    .setTimestamp(new Date());

  if (interaction) {
    await interaction.reply({ embeds: [embed], ephemeral });
  } else {
    const channelId = channelOverride || process.env.NEWS_CHANNEL_ID;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    await channel.send({ embeds: [embed] });
  }
}

// ===== Slash Command Registration =====
async function registerSlashCommands() {
  const token = process.env.DISCORD_TOKEN;
  const guildId = process.env.COMMAND_GUILD_ID;

  if (!token || !guildId) {
    console.warn("⚠️ Missing DISCORD_TOKEN or COMMAND_GUILD_ID — skipping slash registration");
    return;
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("forumwire-top")
      .setDescription("Show the top active threads right now."),
    new SlashCommandBuilder()
      .setName("forumwire-status")
      .setDescription("Show current ForumWire status."),
    new SlashCommandBuilder()
      .setName("forumwire-clearcache")
      .setDescription("Clear ForumWire’s persistent cache."),
  ].map((c) => c.toJSON());

  try {
    const rest = new REST({ version: "10" }).setToken(token);
    const app = await rest.get(Routes.oauth2CurrentApplication());
    await rest.put(Routes.applicationGuildCommands(app.id, guildId), {
      body: commands,
    });
    console.log(`✅ Slash commands registered to guild ${guildId}`);
  } catch (err) {
    console.error("❌ Failed to register slash commands:", err);
  }
}

// ===== Slash Command Handlers =====
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "forumwire-top") {
      await postTrending(null, true, interaction);
    }

    if (interaction.commandName === "forumwire-status") {
      const info = [
        `Feeds: ${FEED_URLS.length}`,
        `Cached Threads: ${postedThreads.size}`,
        `Observations: ${observations.length}`,
        `Check interval: ${Math.round(NEW_CHECK_MS / 60000)} min`,
        `Trending interval: ${Math.round(ACTIVE_SUMMARY_MS / 3600000)} hr`,
      ].join("\n");

      const embed = new EmbedBuilder()
        .setTitle("🧭 ForumWire Status")
        .setDescription(info)
        .setColor(COLOR_NEW)
        .setTimestamp(new Date());
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === "forumwire-clearcache") {
      postedThreads.clear();
      observations.length = 0;
      saveCache();
      await interaction.reply({
        content: "✅ ForumWire cache cleared and saved.",
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error("Interaction error:", err);
    if (!interaction.replied)
      await interaction.reply({
        content: "⚠️ Error executing command.",
        ephemeral: true,
      });
  }
});

// ===== Startup =====
client.once(Events.ClientReady, async () => {
  console.log(`✅ ${BOT_NAME} logged in as ${client.user.tag}`);
  await registerSlashCommands();

  FEED_URLS.forEach((u, i) => {
    setTimeout(() => {
      fetchFeed(u);
      setInterval(() => fetchFeed(u), NEW_CHECK_MS);
    }, i * 5000);
  });

  setInterval(postTrending, ACTIVE_SUMMARY_MS);
});

client.login(process.env.DISCORD_TOKEN);
