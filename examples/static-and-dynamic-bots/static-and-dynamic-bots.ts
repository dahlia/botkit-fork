// One instance that combines a static bot and a group of dynamic bots.
//
//  Static:  @announce@your-domain
//           Accepts follows and rebroadcasts every mention as a public post.
//
//  Dynamic: @lang_<code>@your-domain  (en, ko, ja)
//           Greets followers and mentions in the matching language.
//
// Run:  deno serve --allow-net --allow-env --unstable-kv multi-bots.ts
// Set:  ORIGIN=https://your-domain

import { createInstance, text } from "@fedify/botkit";
import { DenoKvMessageQueue, DenoKvStore } from "@fedify/denokv";

const kv = await Deno.openKv();

const instance = createInstance<void>({
  kv: new DenoKvStore(kv),
  queue: new DenoKvMessageQueue(kv),
  behindProxy: true,
});

// ── Static: @announce ─────────────────────────────────────────────────────────

const announceBot = instance.createBot("announce", {
  username: "announce",
  name: "Announcement Bot",
  summary:
    text`Follow me for announcements, or mention me to broadcast a message.`,
  followerPolicy: "accept",
});

announceBot.onMention = async (session, message) => {
  await session.publish(
    text`📣 ${message.actor} says: ${message.text}`,
  );
};

// ── Dynamic: @lang_<code> ─────────────────────────────────────────────────────

const LANGUAGES: Record<string, { name: string; greeting: string }> = {
  en: { name: "English Bot", greeting: "Hello" },
  ko: { name: "한국어 봇", greeting: "안녕하세요" },
  ja: { name: "日本語ボット", greeting: "こんにちは" },
};

const langBots = instance.createBot((_ctx, identifier) => {
  if (!identifier.startsWith("lang_")) return null;
  const code = identifier.slice("lang_".length);
  const lang = LANGUAGES[code];
  if (lang == null) return null;
  return {
    username: identifier,
    name: lang.name,
    summary: text`I greet you in ${code.toUpperCase()}!`,
    followerPolicy: "accept",
  };
});

langBots.onFollow = async (session, followRequest) => {
  const code = session.bot.identifier.slice("lang_".length);
  const lang = LANGUAGES[code]!;
  await session.publish(
    text`${lang.greeting}, ${followRequest.follower}!`,
    { visibility: "direct" },
  );
};

langBots.onMention = async (session, message) => {
  const code = session.bot.identifier.slice("lang_".length);
  const lang = LANGUAGES[code]!;
  await message.reply(text`${lang.greeting}, ${message.actor}!`);
};

export default instance;
