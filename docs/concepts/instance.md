---
description: >-
  An Instance owns the shared infrastructure and can host multiple bots,
  each with its own actor identity and event handlers.  Learn how to create
  an instance, host static and dynamic bots on it, and migrate an existing
  single-bot deployment.
---

Instance
========

*This API is available since BotKit 0.5.0.*

An `Instance` is a server that can host multiple bots.  It owns the shared
infrastructure: the key–value store, the message queue, the repository, and
HTTP handling.  Each bot hosted on it has its own actor identity, fediverse
handle, collections, and event handlers, while all of them share one
[Fedify federation] under the hood.

If your server hosts a single bot, you don't need this API: `createBot()`
creates a dedicated instance for the bot internally, and everything described
in the [*Bot* concept document](./bot.md) keeps working as before.  Reach for
`createInstance()` when you want several bots, or a whole family of bots
resolved from a database, to share one process and one domain.

[Fedify federation]: https://fedify.dev/manual/federation


Creating an instance
--------------------

You can create an `Instance` by calling the `createInstance()` function:

~~~~ typescript twoslash
import { createInstance } from "@fedify/botkit";
import { MemoryKvStore } from "@fedify/fedify";

const instance = createInstance<void>({
  kv: new MemoryKvStore(),
});
~~~~

The `CreateInstanceOptions` take the infrastructure-related options that
`createBot()` used to take: `~CreateInstanceOptions.kv`,
`~CreateInstanceOptions.repository`, `~CreateInstanceOptions.queue`,
`~CreateInstanceOptions.software`, `~CreateInstanceOptions.behindProxy`, and
`~CreateInstanceOptions.pages`.  A single repository stores the data of every
bot hosted on the instance, scoped by their identifiers; see the
[*Repository* concept document](./repository.md) for details.

Like a `Bot`, an `Instance` has a `~Instance.fetch()` method to be connected
to the HTTP server:

~~~~ typescript twoslash
import { createInstance } from "@fedify/botkit";
import { MemoryKvStore } from "@fedify/fedify";

const instance = createInstance<void>({
  kv: new MemoryKvStore(),
});
// ---cut-before---
export default instance;  // Deno
~~~~


Static bots
-----------

The `Instance.createBot()` method creates a bot with a fixed identifier and
profile, hosted on the instance:

~~~~ typescript twoslash
import { createInstance, text } from "@fedify/botkit";
import { MemoryKvStore } from "@fedify/fedify";

const instance = createInstance<void>({
  kv: new MemoryKvStore(),
});
// ---cut-before---
const greetBot = instance.createBot("greet", {
  username: "greetbot",
  name: "Greeting Bot",
});

greetBot.onFollow = async (session, followRequest) => {
  await followRequest.accept();
  await session.publish(text`Welcome, ${followRequest.follower}!`);
};
~~~~

The first argument is the bot's internal identifier, which is used for the
actor URI and *should not* be changed after the bot is federated.  The second
argument is a `BotProfile`, which takes the profile-related options that
`createBot()` used to take: `~BotProfile.username`, `~BotProfile.name`,
`~BotProfile.summary`, `~BotProfile.icon`, `~BotProfile.image`,
`~BotProfile.properties`, `~BotProfile.class`, and
`~BotProfile.followerPolicy`.

Identifiers and usernames must be unique across the instance;
`~Instance.createBot()` throws a `TypeError` on duplicates.

Handler registration works exactly like on a `Bot` created by `createBot()`;
see the [*Events* concept document](./events.md).  Incoming activities are
routed to the bots they are relevant to: a `Follow` reaches the followed bot,
a `Like` reaches the owner of the liked message, a mention reaches the
mentioned bot, and a message from a followed account reaches the bots that
follow its author.


Dynamic bots
------------

Passing a function instead of an identifier to `~Instance.createBot()`
creates a `BotGroup`: a family of bots resolved on demand by
a `BotDispatcher`.  This suits scenarios like “one bot per region,” where
thousands of potential bots are backed by a database rather than declared up
front:

~~~~ typescript twoslash
declare const db: {
  getRegion(code: string): Promise<{ name: string } | null>;
  getWeather(code: string): Promise<string>;
};
import { createInstance, text } from "@fedify/botkit";
import { MemoryKvStore } from "@fedify/fedify";

const instance = createInstance<void>({
  kv: new MemoryKvStore(),
});
// ---cut-before---
const weatherBots = instance.createBot(async (ctx, identifier) => {
  // Return null for identifiers this dispatcher doesn't handle:
  if (!identifier.startsWith("weather_")) return null;
  const region = await db.getRegion(identifier.slice("weather_".length));
  if (region == null) return null;
  return {
    username: identifier,
    name: `${region.name} Weather Bot`,
  };
});

weatherBots.onMention = async (session, message) => {
  // session.bot tells which bot is being mentioned:
  const code = session.bot.identifier.slice("weather_".length);
  const weather = await db.getWeather(code);
  await message.reply(text`Current weather: ${weather}`);
};
~~~~

The dispatcher is invoked whenever an identifier needs to be resolved, e.g.
for serving an actor or routing an incoming activity, so it should be fast.
Resolutions are memoized for the duration of a request, but not across
requests; look profiles up from a database rather than computing them
expensively.

Event handlers registered on the group are shared by every bot it resolves,
and they are read at dispatch time, so the registration order of handlers
and the first resolution of a bot don't matter.

Static bots take precedence over dynamic ones, and when multiple groups are
registered, their dispatchers are probed in the order the groups were
created: a dispatcher that returns `null` passes the identifier on to the
next group, and an identifier no dispatcher recognizes does not resolve at
all.

### Usernames of dynamic bots

By default, BotKit assumes that a dynamic bot's username equals its
identifier, which makes WebFinger lookups (`@weather_kr@your-domain`) work
without extra configuration.  If your usernames differ from your
identifiers, provide a `~CreateBotGroupOptions.mapUsername` callback:

~~~~ typescript twoslash
declare const db: {
  getRegionByName(name: string): Promise<{ code: string } | null>;
};
import { createInstance } from "@fedify/botkit";
import { MemoryKvStore } from "@fedify/fedify";

const instance = createInstance<void>({
  kv: new MemoryKvStore(),
});
declare function dispatcher(ctx: unknown, identifier: string): null;
// ---cut-before---
const weatherBots = instance.createBot(
  async (ctx, identifier) => {
    // …resolve the profile from the identifier…
    return dispatcher(ctx, identifier);
  },
  {
    async mapUsername(ctx, username) {
      const region = await db.getRegionByName(username);
      return region == null ? null : `weather_${region.code}`;
    },
  },
);
~~~~

When both are provided, it is your responsibility to keep the
identifier-to-profile and username-to-identifier mappings consistent.

### Sessions for dynamic bots

Since a group has no single identifier, `BotGroup.getSession()` takes the
identifier of the bot to control:

~~~~ typescript twoslash
declare const dispatcher: import("@fedify/botkit").BotDispatcher<void>;
import { createInstance, text } from "@fedify/botkit";
import { MemoryKvStore } from "@fedify/fedify";

const instance = createInstance<void>({
  kv: new MemoryKvStore(),
});
const weatherBots = instance.createBot(dispatcher);
// ---cut-before---
const session = await weatherBots.getSession(
  "https://mydomain",
  "weather_kr",
);
await session.publish(text`It's sunny in Seoul today!`);
~~~~

It returns a `Promise` since the dispatcher has to resolve the identifier
first, and it rejects with a `TypeError` when the dispatcher doesn't
recognize the identifier.


The instance actor
------------------

A multi-bot instance has no single obvious actor whose key should sign
shared-inbox related requests, so it exposes an *instance actor* under the
reserved `INSTANCE_ACTOR_IDENTIFIER` (`_instance`) identifier: an internal,
non-discoverable `Application` actor, similar to Mastodon's instance actor.
Bots cannot take the reserved identifier.

Instances created through the single-bot `createBot()` function keep the
pre-0.5 behavior: the sole bot's key signs shared-inbox requests and no
instance actor is exposed.


Web pages
---------

A multi-bot instance serves a list of its static bots at the web root, and
each bot's pages under a path derived from its username:

 -  `/@{username}`: the bot's profile
 -  `/@{username}/{messageId}`: a message permalink
 -  `/@{username}/followers`: the bot's followers
 -  `/@{username}/tags/{hashtag}`: the bot's messages with a hashtag
 -  `/@{username}/feed.xml`: the bot's Atom feed

Dynamic bots get the same pages once their usernames resolve.  Single-bot
deployments created through `createBot()` keep serving their pages at the
web root as before.


Custom emojis
-------------

Custom emojis belong to the instance and are shared by every bot hosted on
it.  The `Instance.addCustomEmojis()` method works like
[`Bot.addCustomEmojis()`](./text.md#custom-emojis), and emoji names must be
unique across the instance.


Migrating a single-bot deployment
---------------------------------

An existing deployment created with `createBot()` keeps working without any
changes: its data is migrated to the bot-scoped storage layout on startup,
object URIs in the old format are recognized and redirected, and its web
pages stay at the root.

If you later want to move a single-bot deployment onto a multi-bot instance,
two things need to carry over.  First, the repository data: the automatic
migration runs only in the `createBot()` compatibility path, so either run
the deployment once with `createBot()` on BotKit 0.5.0 before switching to
`createInstance()`, or call the repository's `~Repository.migrate()` method
with the bot's identifier yourself.  Second, the object URIs: create the
instance with the `~CreateInstanceOptions.legacyObjectUris` option, so that
object URIs generated by BotKit 0.4 or earlier are still attributed to the
original bot:

~~~~ typescript twoslash
import { createInstance } from "@fedify/botkit";
import { MemoryKvStore } from "@fedify/fedify";
// ---cut-before---
const instance = createInstance<void>({
  kv: new MemoryKvStore(),
  legacyObjectUris: { identifier: "bot" },
});
~~~~

Note that the web page paths change in that case (from `/` to
`/@{username}`), while actor URIs and follower relationships are preserved.
