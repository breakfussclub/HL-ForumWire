import { REST, Routes, SlashCommandBuilder } from "discord.js";

const token = process.env.DISCORD_TOKEN;
const guild = process.env.COMMAND_GUILD_ID;

if (!token || !guild) throw new Error("Missing DISCORD_TOKEN or COMMAND_GUILD_ID");

const commands = [
  new SlashCommandBuilder()
    .setName("forumwire-top")
    .setDescription("Show top active threads."),
  new SlashCommandBuilder()
    .setName("forumwire-status")
    .setDescription("Show bot status."),
  new SlashCommandBuilder()
    .setName("forumwire-clearcache")
    .setDescription("Clear the cache."),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  const app = await rest.get(Routes.oauth2CurrentApplication());
  await rest.put(Routes.applicationGuildCommands(app.id, guild), { body: commands });
  console.log("✅ Slash commands registered to guild:", guild);
})();
