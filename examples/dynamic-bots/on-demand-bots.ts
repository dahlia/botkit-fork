// A group of per-language bots resolved on demand from an in-memory table.
//
// Each bot has the handle @lang_<code>@your-domain where <code> is one of
// the supported BCP 47 language codes.  The dispatcher returns null for any
// identifier it doesn't recognize, so only the codes in LANGUAGES resolve.
//
// Run:  deno serve --allow-net --allow-env --unstable-kv dynamic-bots.ts
// Set:  ORIGIN=https://your-domain

import { createInstance, text } from "@fedify/botkit";
import { DenoKvMessageQueue, DenoKvStore } from "@fedify/denokv";

const kv = await Deno.openKv();

const LANGUAGES: Record<string, { name: string; greeting: string }> = {
  en: { name: "English Bot", greeting: "Hello" },
  ko: { name: "한국어 봇", greeting: "안녕하세요" },
  ja: { name: "日本語ボット", greeting: "こんにちは" },
  es: { name: "Spanish Bot", greeting: "¡Hola" },
  fr: { name: "French Bot", greeting: "Bonjour" },
};

const instance = createInstance<void>({
  kv: new DenoKvStore(kv),
  queue: new DenoKvMessageQueue(kv),
  behindProxy: true,
});

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
