// Two static bots on one instance:
//
//  - @greetbot sends a welcome DM to every new follower and says hi when
//    mentioned.
//  - @echobot echoes back the plain text of every mention.
//
// Run:  deno serve --allow-net --allow-env --unstable-kv static-bots.ts
// Set:  ORIGIN=https://your-domain

import { createInstance, text } from "@fedify/botkit";
import { DenoKvMessageQueue, DenoKvStore } from "@fedify/denokv";

const kv = await Deno.openKv();

const instance = createInstance<void>({
  kv: new DenoKvStore(kv),
  queue: new DenoKvMessageQueue(kv),
  behindProxy: true,
});

// ── @greetbot ─────────────────────────────────────────────────────────────────

const greetBot = instance.createBot("greet", {
  username: "greetbot",
  name: "Greeting Bot",
  summary: text`I send a warm welcome to every new follower!`,
  followerPolicy: "accept",
});

greetBot.onFollow = async (session, followRequest) => {
  await session.publish(
    text`Welcome, ${followRequest.follower}! Thanks for the follow!`,
    { visibility: "direct" },
  );
};

greetBot.onMention = async (_session, message) => {
  await message.reply(text`Hello, ${message.actor}!`);
};

// ── @echobot ──────────────────────────────────────────────────────────────────

const echoBot = instance.createBot("echo", {
  username: "echobot",
  name: "Echo Bot",
  summary: text`Mention me and I'll echo back whatever you say.`,
  followerPolicy: "accept",
});

echoBot.onMention = async (_session, message) => {
  await message.reply(text`Echo: ${message.text}`);
};

export default instance;
