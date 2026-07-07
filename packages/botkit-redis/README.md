@fedify/botkit-redis
====================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![GitHub Actions][GitHub Actions badge]][GitHub Actions]

This package is a [Redis]-based repository implementation for [BotKit].  It
provides shared persistent storage for bots running on either [Deno] or
[Node.js], using Redis data structures for BotKit repository data.

[JSR badge]: https://jsr.io/badges/@fedify/botkit-redis
[JSR]: https://jsr.io/@fedify/botkit-redis
[npm badge]: https://img.shields.io/npm/v/@fedify/botkit-redis?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/botkit-redis
[GitHub Actions badge]: https://github.com/fedify-dev/botkit/actions/workflows/main.yaml/badge.svg
[GitHub Actions]: https://github.com/fedify-dev/botkit/actions/workflows/main.yaml
[Redis]: https://redis.io/
[BotKit]: https://botkit.fedify.dev/
[Deno]: https://deno.land/
[Node.js]: https://nodejs.org/


Installation
------------

~~~~ sh
deno add jsr:@fedify/botkit-redis
npm  add     @fedify/botkit-redis
pnpm add     @fedify/botkit-redis
yarn add     @fedify/botkit-redis
~~~~


Usage
-----

The `RedisRepository` can be used as a drop-in repository implementation for
BotKit:

~~~~ typescript
import { createBot, MemoryKvStore } from "@fedify/botkit";
import { RedisRepository } from "@fedify/botkit-redis";

const bot = createBot({
  username: "mybot",
  kv: new MemoryKvStore(),
  repository: new RedisRepository({
    url: "redis://localhost:6379/0",
    prefix: "botkit",
  }),
});
~~~~

You can also inject an existing node-redis client.  In that case the
repository does not own the client and `close()` will not shut it down:

~~~~ typescript
import { RedisRepository } from "@fedify/botkit-redis";
import { createClient } from "redis";

const client = createClient({ url: "redis://localhost:6379/0" });
await client.connect();

const repository = new RedisRepository({
  client,
  prefix: "botkit",
});
~~~~


Options
-------

The `RedisRepository` constructor accepts the following options:

 -  **`url`**: A Redis connection string for an internally managed client.

 -  **`client`**: An existing node-redis compatible client to use.

 -  **`prefix`** (optional): Redis key prefix used for BotKit data.  Defaults
    to `"botkit"`.

 -  **`clientOptions`** (optional): Additional node-redis client options.
    This option is only valid together with `url`.

 -  **`lockTimeoutMs`** (optional): How long a Redis lock can live without
    renewal, in milliseconds.  Defaults to `30000`.

 -  **`lockPollIntervalMs`** (optional): How long to wait before retrying a
    held Redis lock, in milliseconds.  Defaults to `20`.

 -  **`lockRenewIntervalMs`** (optional): How often to renew a held Redis lock,
    in milliseconds.  Defaults to `10000`.

The options are mutually exclusive: use either `client` or `url`.


Features
--------

 -  **Cross-runtime**: Works with both Deno and Node.js using node-redis.

 -  **Shared persistent storage**: Suitable for multi-process deployments
    backed by Redis.

 -  **Key namespacing**: Keeps BotKit data under a configurable Redis prefix.

 -  **Full `Repository` API**: Implements BotKit repository storage for key
    pairs, messages, followers, follows, followees, quote authorizations, and
    poll votes.

 -  **Explicit resource ownership**: Repositories created from a URL own their
    Redis client, while repositories created from an injected client leave
    lifecycle control to the caller.
