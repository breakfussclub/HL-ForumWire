import Parser from 'rss-parser';
import { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, Events, Partials } from 'discord.js';
import sqlite3 from 'sqlite3';

const parser = new Parser({ timeout: 20000 });
const FEED_URLS = (process.env.FEED_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!FEED_URLS.length) throw new Error('FEED_URLS is required');

const FEED_CHANNEL_MAP = safeJSON(process.env.FEED_CHANNEL_MAP || '{}');
const BOT_NAME = process.env.BOT_NAME || 'ForumWire';
const DB_FILE = process.env.DB_FILE || './forumwire.sqlite';

const NEW_CHECK_MS = Number(process.env.NEW_CHECK_MS) || 300000;        // 5 minutes
const ACTIVE_SUMMARY_MS = Number(process.env.ACTIVE_SUMMARY_MS) || 21600000; // 6 hours
const ACTIVE_SUMMARY_HOURS = Number(process.env.ACTIVE_SUMMARY_HOURS) || 24;
const ACTIVE_SUMMARY_LIMIT = Number(process.env.ACTIVE_SUMMARY_LIMIT) || 5;

const COLOR_NEW = 0x0077ff;
const COLOR_TRENDING = 0xffa500;

const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });
const db = new sqlite3.Database(DB_FILE);

await initDB();

async function initDB() {
  await run(`CREATE TABLE IF NOT EXISTS posted (id TEXT PRIMARY KEY, url TEXT, title TEXT, seen INTEGER)`);
  await run(`CREATE TABLE IF NOT EXISTS observations (id TEXT, url TEXT, title TEXT, seen INTEGER)`);
}

function run(sql, params=[]) { return new Promise((res, rej)=>db.run(sql, params, e=>e?rej(e):res())); }
function all(sql, params=[]) { return new Promise((res, rej)=>db.all(sql, params, (e,r)=>e?rej(e):res(r))); }
function safeJSON(str){ try{return JSON.parse(str);}catch{return {};}}
function normalize(link){ return link.split('/page-')[0].replace(/\\/$/, ''); }
function idFrom(link){ const m = link.match(/\\.([0-9]+)/); return m?m[1]:link; }

async function fetchFeed(url){
  const feed = await parser.parseURL(url);
  for(const item of feed.items){ await processItem(item, url); }
}

async function processItem(item, feedUrl){
  const link = normalize(item.link);
  const id = idFrom(link);
  const title = item.title || 'Untitled Thread';
  const now = Date.now();

  await run(`INSERT INTO observations(id,url,title,seen) VALUES(?,?,?,?)`, [id, link, title, now]);
  const exists = await all(`SELECT id FROM posted WHERE id=?`, [id]);
  if (exists.length) return;

  const channelId = FEED_CHANNEL_MAP[feedUrl] || process.env.NEWS_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(()=>null);
  if (!channel) return;

  const color = feedUrl.includes('dapcity') ? 0xda4453 : COLOR_NEW;
  const source = feedUrl.includes('dapcity') ? 'DapCity' : 'TheColi';

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setURL(link)
    .setColor(color)
    .setFooter({ text: `${BOT_NAME} — ${source}` })
    .setTimestamp(new Date());

  await channel.send({ embeds:[embed] });
  await run(`INSERT INTO posted(id,url,title,seen) VALUES(?,?,?,?)`, [id, link, title, now]);
}

async function postTrending(){
  const cutoff = Date.now() - ACTIVE_SUMMARY_HOURS*3600*1000;
  const rows = await all(`SELECT id,url,title,COUNT(*) as c FROM observations WHERE seen>? GROUP BY id ORDER BY c DESC LIMIT ?`, [cutoff, ACTIVE_SUMMARY_LIMIT]);
  if (!rows.length) return;

  const channelId = process.env.NEWS_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(()=>null);
  if (!channel) return;

  const desc = rows.map((r,i)=>`**${i+1}.** [${r.title}](${r.url}) — ${r.c} updates`).join('\\n');
  const embed = new EmbedBuilder()
    .setTitle(`🔥 Most Active Threads (Past ${ACTIVE_SUMMARY_HOURS}h)`)
    .setDescription(desc)
    .setColor(COLOR_TRENDING)
    .setFooter({ text: BOT_NAME })
    .setTimestamp(new Date());

  await channel.send({ embeds:[embed] });
}

client.once(Events.ClientReady, ()=>{
  console.log(`✅ ${BOT_NAME} logged in as ${client.user.tag}`);
  FEED_URLS.forEach((u,i)=>{
    setTimeout(()=>{fetchFeed(u); setInterval(()=>fetchFeed(u),NEW_CHECK_MS);}, i*5000);
  });
  setInterval(postTrending, ACTIVE_SUMMARY_MS);
});

client.login(process.env.DISCORD_TOKEN);
