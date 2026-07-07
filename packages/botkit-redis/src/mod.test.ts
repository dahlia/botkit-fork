// BotKit by Fedify: A framework for creating ActivityPub bots
// Copyright (C) 2026 Hong Minhee <https://hongminhee.org/>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
import { RedisRepository } from "@fedify/botkit-redis";
import { exportJwk } from "@fedify/fedify/sig";
import {
  Create,
  Follow,
  Note,
  Person,
  PUBLIC_COLLECTION,
  QuoteAuthorization,
} from "@fedify/vocab";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createClient } from "redis";

if (!("Temporal" in globalThis)) {
  globalThis.Temporal = (await import("@js-temporal" + "/polyfill")).Temporal;
}

function getRedisUrl(): string | undefined {
  if ("process" in globalThis) return globalThis.process.env.REDIS_URL;
  if ("Deno" in globalThis) return globalThis.Deno.env.get("REDIS_URL");
  return undefined;
}

const redisUrl = getRedisUrl();

interface TestRedisClient {
  readonly isOpen: boolean;
  sendCommand(args: readonly string[]): Promise<unknown>;
}

interface DelayedGetState {
  count: number;
  readonly waiters: (() => void)[];
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

async function createKeyPairs(): Promise<CryptoKeyPair[]> {
  return [
    await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    ),
  ];
}

function createMessage(id: string, content: string, published: string): Create {
  return new Create({
    id: new URL(`https://example.com/ap/actor/bot/create/${id}`),
    actor: new URL("https://example.com/ap/actor/bot"),
    to: new URL("https://example.com/ap/actor/bot/followers"),
    cc: PUBLIC_COLLECTION,
    object: new Note({
      id: new URL(`https://example.com/ap/actor/bot/note/${id}`),
      attribution: new URL("https://example.com/ap/actor/bot"),
      content,
      published: Temporal.Instant.from(published),
    }),
    published: Temporal.Instant.from(published),
  });
}

async function getMessageContent(message: Create): Promise<string> {
  const json = await message.toJsonLd({ format: "compact" });
  if (typeof json !== "object" || json == null) {
    throw new TypeError("Expected a JSON-LD object.");
  }
  if (!("object" in json)) {
    throw new TypeError("Expected a Create object.");
  }
  const object = json.object;
  if (typeof object !== "object" || object == null) {
    throw new TypeError("Expected a nested object.");
  }
  if (!("content" in object) || typeof object.content !== "string") {
    throw new TypeError("Expected string content.");
  }
  return object.content;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupPrefix(url: string, prefix: string): Promise<void> {
  const client = createClient({ url });
  await client.connect();
  try {
    let cursor = "0";
    for (;;) {
      const reply = await client.sendCommand([
        "SCAN",
        cursor,
        "MATCH",
        `${prefix}:*`,
        "COUNT",
        "1000",
      ]);
      assert.ok(Array.isArray(reply));
      const keys = reply[1];
      assert.ok(Array.isArray(keys));
      if (keys.length > 0) {
        await client.sendCommand(["DEL", ...keys.map(String)]);
      }
      cursor = String(reply[0]);
      if (cursor === "0") break;
    }
  } finally {
    await client.quit();
  }
}

function createHarness() {
  if (redisUrl == null) throw new Error("REDIS_URL is not set.");
  const prefix = `botkit_test_${crypto.randomUUID()}`;
  const repository = new RedisRepository({ url: redisUrl, prefix });
  return {
    prefix,
    repository,
    async cleanup() {
      await repository.close();
      await cleanupPrefix(redisUrl, prefix);
    },
  };
}

function createDelayedGetClient(
  client: TestRedisClient,
  key: string,
  state: DelayedGetState,
) {
  return {
    get isOpen(): boolean {
      return client.isOpen;
    },

    sendCommand(args: readonly string[]): Promise<unknown> {
      return (async () => {
        if (args[0] === "GET" && args[1] === key) {
          state.count++;
          if (state.count < 2) {
            await new Promise<void>((resolve) => {
              state.waiters.push(resolve);
              setTimeout(resolve, 50);
            });
          } else {
            for (const resolve of state.waiters) resolve();
            state.waiters.length = 0;
          }
        }
        return await client.sendCommand([...args]);
      })();
    },
  };
}

function createDeferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createDelayedDeleteClient(
  client: TestRedisClient,
  key: string,
  observed: Deferred,
  release: Deferred,
) {
  return {
    get isOpen(): boolean {
      return client.isOpen;
    },

    sendCommand(args: readonly string[]): Promise<unknown> {
      return (async () => {
        if (args[0] === "DEL" && args[1] === key) {
          observed.resolve();
          await release.promise;
        }
        return await client.sendCommand([...args]);
      })();
    },
  };
}

if (redisUrl == null) {
  test("RedisRepository integration tests", { skip: true }, () => {});
} else {
  describe("RedisRepository", () => {
    test("rejects invalid constructor option combinations", () => {
      assert.throws(
        () => Reflect.construct(RedisRepository, [{}]),
        new TypeError(
          "RedisRepositoryOptions must provide exactly one of client or url.",
        ),
      );
      assert.throws(
        () =>
          Reflect.construct(RedisRepository, [{
            client: { sendCommand: () => Promise.resolve(undefined) },
            url: redisUrl,
          }]),
        new TypeError(
          "RedisRepositoryOptions must provide exactly one of client or url.",
        ),
      );
      assert.throws(
        () =>
          new RedisRepository({
            client: { sendCommand: () => Promise.resolve(undefined) },
            lockTimeoutMs: 0,
          }),
        new RangeError("lockTimeoutMs must be a positive number."),
      );
      assert.throws(
        () =>
          new RedisRepository({
            client: { sendCommand: () => Promise.resolve(undefined) },
            lockTimeoutMs: 1_000,
            lockRenewIntervalMs: 1_000,
          }),
        new RangeError(
          "lockRenewIntervalMs must be less than lockTimeoutMs.",
        ),
      );
    });

    test("key pairs", async () => {
      const { repository, cleanup } = createHarness();
      try {
        const keyPairs = await createKeyPairs();
        assert.deepStrictEqual(await repository.getKeyPairs("bot"), undefined);
        await repository.setKeyPairs("bot", keyPairs);
        assert.deepStrictEqual(
          await Promise.all(
            (await repository.getKeyPairs("bot"))!.map((pair) =>
              exportJwk(pair.publicKey)
            ),
          ),
          await Promise.all(keyPairs.map((pair) => exportJwk(pair.publicKey))),
        );
      } finally {
        await cleanup();
      }
    });

    test("does not close injected clients", async () => {
      if (redisUrl == null) throw new Error("REDIS_URL is not set.");
      const prefix = `botkit_test_${crypto.randomUUID()}`;
      const client = createClient({ url: redisUrl });
      await client.connect();
      const repository = new RedisRepository({ client, prefix });
      try {
        assert.ok(client.isOpen);
        await repository.close();
        assert.ok(client.isOpen);
      } finally {
        await client.quit();
        await cleanupPrefix(redisUrl, prefix);
      }
    });

    test("messages basic operations and ordering", async () => {
      const { repository, cleanup } = createHarness();
      try {
        const firstId = "01941f29-7c00-7fe8-ab0a-7b593990a3c0";
        const secondId = "01942976-3400-7f34-872e-2cbf0f9eeac4";
        const first = createMessage(firstId, "first", "2025-01-01T00:00:00Z");
        const second = createMessage(
          secondId,
          "second",
          "2025-01-02T00:00:00Z",
        );

        assert.deepStrictEqual(await repository.countMessages("bot"), 0);
        await repository.addMessage("bot", firstId, first);
        await repository.addMessage("bot", secondId, second);
        assert.deepStrictEqual(await repository.countMessages("bot"), 2);
        assert.deepStrictEqual(
          await repository.getMessage("other", firstId),
          undefined,
        );
        assert.deepStrictEqual(
          await (await repository.getMessage("bot", firstId))?.toJsonLd(),
          await first.toJsonLd(),
        );
        assert.deepStrictEqual(
          (await Array.fromAsync(
            repository.getMessages("bot", { order: "oldest" }),
          )).length,
          2,
        );
        assert.deepStrictEqual(
          (await Array.fromAsync(repository.getMessages("bot", {
            since: Temporal.Instant.from("2025-01-02T00:00:00Z"),
          }))).length,
          1,
        );
        assert.deepStrictEqual(
          await (await repository.removeMessage("bot", firstId))?.toJsonLd(),
          await first.toJsonLd(),
        );
        assert.deepStrictEqual(await repository.countMessages("bot"), 1);
      } finally {
        await cleanup();
      }
    });

    test("serializes concurrent message updates", async () => {
      const { repository, cleanup } = createHarness();
      try {
        const messageId = "01941f29-7c00-7fe8-ab0a-7b593990a3c0";
        const message = createMessage(
          messageId,
          "base",
          "2025-01-01T00:00:00Z",
        );
        await repository.addMessage("bot", messageId, message);

        let activeUpdaters = 0;
        let maxActiveUpdaters = 0;
        const append = (suffix: string) =>
          repository.updateMessage("bot", messageId, async (existing) => {
            assert.ok(existing instanceof Create);
            activeUpdaters++;
            maxActiveUpdaters = Math.max(maxActiveUpdaters, activeUpdaters);
            const content = await getMessageContent(existing);
            await delay(50);
            activeUpdaters--;
            return existing.clone({
              object: new Note({
                content: `${content}${suffix}`,
              }),
            });
          });

        assert.deepStrictEqual(await Promise.all([append("A"), append("B")]), [
          true,
          true,
        ]);
        assert.deepStrictEqual(maxActiveUpdaters, 1);

        const updated = await repository.getMessage("bot", messageId);
        assert.ok(updated instanceof Create);
        const content = await getMessageContent(updated);
        assert.ok(content === "baseAB" || content === "baseBA");
      } finally {
        await cleanup();
      }
    });

    test("renews Redis locks during long message updates", async () => {
      const prefix = `botkit_test_${crypto.randomUUID()}`;
      const firstClient = createClient({ url: redisUrl });
      const secondClient = createClient({ url: redisUrl });
      await firstClient.connect();
      await secondClient.connect();
      const messageId = "01941f29-7c00-7fe8-ab0a-7b593990a3c0";
      const firstRepository = new RedisRepository({
        client: firstClient,
        prefix,
        lockTimeoutMs: 1_500,
        lockRenewIntervalMs: 500,
      });
      const secondRepository = new RedisRepository({
        client: secondClient,
        prefix,
        lockTimeoutMs: 1_500,
        lockRenewIntervalMs: 500,
      });
      try {
        const message = createMessage(
          messageId,
          "base",
          "2025-01-01T00:00:00Z",
        );
        await firstRepository.addMessage("bot", messageId, message);

        let activeUpdaters = 0;
        let maxActiveUpdaters = 0;
        const append = (
          repository: RedisRepository,
          suffix: string,
          waitMs: number,
        ) =>
          repository.updateMessage("bot", messageId, async (existing) => {
            assert.ok(existing instanceof Create);
            activeUpdaters++;
            maxActiveUpdaters = Math.max(maxActiveUpdaters, activeUpdaters);
            const content = await getMessageContent(existing);
            await delay(waitMs);
            activeUpdaters--;
            return existing.clone({
              object: new Note({
                content: `${content}${suffix}`,
              }),
            });
          });

        assert.deepStrictEqual(
          await Promise.all([
            append(firstRepository, "A", 2_200),
            append(secondRepository, "B", 50),
          ]),
          [true, true],
        );
        assert.deepStrictEqual(maxActiveUpdaters, 1);

        const updated = await firstRepository.getMessage("bot", messageId);
        assert.ok(updated instanceof Create);
        const content = await getMessageContent(updated);
        assert.ok(content === "baseAB" || content === "baseBA");
      } finally {
        await firstRepository.close();
        await secondRepository.close();
        await firstClient.quit();
        await secondClient.quit();
        await cleanupPrefix(redisUrl, prefix);
      }
    });

    test("serializes message removal with concurrent updates", async () => {
      const { repository, cleanup } = createHarness();
      try {
        const messageId = "01941f29-7c00-7fe8-ab0a-7b593990a3c0";
        const message = createMessage(
          messageId,
          "base",
          "2025-01-01T00:00:00Z",
        );
        await repository.addMessage("bot", messageId, message);

        let updaterStarted = false;
        const update = repository.updateMessage(
          "bot",
          messageId,
          async (existing) => {
            assert.ok(existing instanceof Create);
            updaterStarted = true;
            await delay(50);
            const content = await getMessageContent(existing);
            return existing.clone({
              object: new Note({
                content: `${content}A`,
              }),
            });
          },
        );
        while (!updaterStarted) await delay(1);
        const removal = repository.removeMessage("bot", messageId);
        const [updated, removed] = await Promise.all([update, removal]);

        assert.ok(updated);
        assert.deepStrictEqual(
          await removed?.toJsonLd(),
          await message.clone({
            object: new Note({
              content: "baseA",
            }),
          }).toJsonLd(),
        );
        assert.deepStrictEqual(
          await repository.getMessage("bot", messageId),
          undefined,
        );
        assert.deepStrictEqual(await repository.countMessages("bot"), 0);
      } finally {
        await cleanup();
      }
    });

    test("persists data across repository instances", async () => {
      if (redisUrl == null) throw new Error("REDIS_URL is not set.");
      const prefix = `botkit_test_${crypto.randomUUID()}`;
      const firstRepository = new RedisRepository({ url: redisUrl, prefix });
      const secondRepository = new RedisRepository({ url: redisUrl, prefix });
      try {
        const messageId = "01941f29-7c00-7fe8-ab0a-7b593990a3c0";
        const message = createMessage(
          messageId,
          "persisted",
          "2025-01-01T00:00:00Z",
        );
        await firstRepository.addMessage("bot", messageId, message);
        assert.deepStrictEqual(
          await (await secondRepository.getMessage("bot", messageId))
            ?.toJsonLd(),
          await message.toJsonLd(),
        );
      } finally {
        await firstRepository.close();
        await secondRepository.close();
        await cleanupPrefix(redisUrl, prefix);
      }
    });

    test("followers with multiple follow requests", async () => {
      const { repository, cleanup } = createHarness();
      try {
        const follower = new Person({
          id: new URL("https://example.com/ap/actor/alice"),
          preferredUsername: "alice",
        });
        const followA = new URL(
          "https://example.com/ap/follow/f2fb7255-d3ad-4fef-8f9a-1d0f2c2ec0b4",
        );
        const followB = new URL(
          "https://example.com/ap/follow/a3d4cc4f-af93-4a9f-a7b3-0b7c0fe4901d",
        );

        await repository.addFollower("bot", followA, follower);
        await repository.addFollower("bot", followB, follower);
        assert.deepStrictEqual(await repository.countFollowers("bot"), 1);
        assert.ok(await repository.hasFollower("bot", follower.id!));
        assert.deepStrictEqual(
          await repository.removeFollower("bot", followA, follower.id!),
          undefined,
        );
        assert.ok(await repository.hasFollower("bot", follower.id!));
        assert.deepStrictEqual(
          await (await repository.removeFollower("bot", followB, follower.id!))
            ?.toJsonLd(),
          await follower.toJsonLd(),
        );
        assert.deepStrictEqual(await repository.countFollowers("bot"), 0);
      } finally {
        await cleanup();
      }
    });

    test("returns no followers for zero limits", async () => {
      const { repository, cleanup } = createHarness();
      try {
        const follower = new Person({
          id: new URL("https://example.com/ap/actor/alice"),
          preferredUsername: "alice",
        });
        const follow = new URL(
          "https://example.com/ap/follow/f2fb7255-d3ad-4fef-8f9a-1d0f2c2ec0b4",
        );

        await repository.addFollower("bot", follow, follower);
        assert.deepStrictEqual(
          await Array.fromAsync(repository.getFollowers("bot", { limit: 0 })),
          [],
        );
      } finally {
        await cleanup();
      }
    });

    test("serializes racing follower replacement and removal", async () => {
      const { repository, cleanup } = createHarness();
      try {
        const follow = new URL(
          "https://example.com/ap/follow/f2fb7255-d3ad-4fef-8f9a-1d0f2c2ec0b4",
        );
        const alice = new Person({
          id: new URL("https://example.com/ap/actor/alice"),
          preferredUsername: "alice",
        });
        const bob = new Person({
          id: new URL("https://example.com/ap/actor/bob"),
          preferredUsername: "bob",
        });

        for (let i = 0; i < 20; i++) {
          await repository.addFollower("bot", follow, alice);
          await Promise.all([
            repository.removeFollower("bot", follow, alice.id!),
            repository.addFollower("bot", follow, bob),
          ]);

          assert.ok(await repository.hasFollower("bot", bob.id!));
          assert.deepStrictEqual(
            await (await repository.removeFollower("bot", follow, bob.id!))
              ?.toJsonLd(),
            await bob.toJsonLd(),
          );
          assert.deepStrictEqual(await repository.countFollowers("bot"), 0);
        }
      } finally {
        await cleanup();
      }
    });

    test("sent follows, followees, and reverse indexes", async () => {
      const { repository, cleanup } = createHarness();
      try {
        const followeeId = new URL("https://example.com/ap/actor/john");
        const follow = new Follow({
          id: new URL(
            "https://example.com/ap/actor/bot/follow/03a395a2-353a-4894-afdb-2cab31a7b004",
          ),
          actor: new URL("https://example.com/ap/actor/bot"),
          object: followeeId,
        });
        const id = "01941f29-7c00-7fe8-ab0a-7b593990a3c0";

        await repository.addSentFollow("bot", id, follow);
        assert.deepStrictEqual(
          await (await repository.getSentFollow("bot", id))?.toJsonLd(),
          await follow.toJsonLd(),
        );
        assert.deepStrictEqual(
          await (await repository.removeSentFollow("bot", id))?.toJsonLd(),
          await follow.toJsonLd(),
        );

        await repository.addFollowee("bot", followeeId, follow);
        await repository.addFollowee("other", followeeId, follow);
        assert.deepStrictEqual(
          await Array.fromAsync(repository.findFollowedBots(followeeId)),
          ["bot", "other"],
        );
        assert.deepStrictEqual(
          await (await repository.removeFollowee("bot", followeeId))
            ?.toJsonLd(),
          await follow.toJsonLd(),
        );
        assert.deepStrictEqual(
          await Array.fromAsync(repository.findFollowedBots(followeeId)),
          ["other"],
        );
      } finally {
        await cleanup();
      }
    });

    test("poll voting", async () => {
      const { repository, cleanup } = createHarness();
      try {
        const messageId = "01945678-1234-7890-abcd-ef0123456789";
        const voter1 = new URL("https://example.com/ap/actor/alice");
        const voter2 = new URL("https://example.com/ap/actor/bob");
        await repository.vote("bot", messageId, voter1, "option1");
        await repository.vote("bot", messageId, voter1, "option1");
        await repository.vote("bot", messageId, voter2, "option1");
        await repository.vote("bot", messageId, voter1, "option2");
        assert.deepStrictEqual(
          await repository.countVoters("bot", messageId),
          2,
        );
        assert.deepStrictEqual(await repository.countVotes("bot", messageId), {
          option1: 2,
          option2: 1,
        });
      } finally {
        await cleanup();
      }
    });

    test("quote authorizations and references", async () => {
      const { repository, cleanup } = createHarness();
      try {
        const firstId = "01942976-3400-7f34-872e-2cbf0f9eeac4";
        const secondId = "01942976-3400-7f34-872e-2cbf0f9eeac5";
        const quote = new URL("https://remote.example/notes/quote");
        const target = new URL("https://example.com/ap/note/1");
        const first = new QuoteAuthorization({
          id: new URL(
            `https://example.com/ap/actor/bot/quote-authorization/${firstId}`,
          ),
          attribution: new URL("https://example.com/ap/actor/bot"),
          interactingObject: quote,
          interactionTarget: target,
        });
        const second = new QuoteAuthorization({
          id: new URL(
            `https://example.com/ap/actor/bot/quote-authorization/${secondId}`,
          ),
          attribution: new URL("https://example.com/ap/actor/bot"),
          interactingObject: quote,
          interactionTarget: target,
        });

        await repository.addQuoteAuthorization("bot", firstId, first);
        await repository.addQuoteAuthorization("bot", secondId, second);
        assert.deepStrictEqual(
          (await repository.findQuoteAuthorization("bot", quote))?.id?.href,
          first.id?.href,
        );
        assert.deepStrictEqual(
          await repository.getQuoteAuthorization("bot", secondId),
          undefined,
        );

        const stamp = new URL("https://remote.example/stamps/1");
        const attribution = new URL("https://remote.example/actor/alice");
        await repository.addQuoteAuthorizationReference(
          "bot",
          stamp,
          firstId,
          attribution,
        );
        await repository.addQuoteAuthorizationReference(
          "other",
          stamp,
          firstId,
        );
        assert.deepStrictEqual(
          await repository.findQuoteAuthorizationReference("bot", stamp),
          firstId,
        );
        assert.deepStrictEqual(
          await repository.findQuoteAuthorizationReferenceAttribution(
            "bot",
            stamp,
          ),
          attribution,
        );
        assert.deepStrictEqual(
          await Array.fromAsync(
            repository.findQuoteAuthorizationReferenceIdentifiers(stamp),
          ),
          ["bot", "other"],
        );
        await repository.removeQuoteAuthorizationReference("bot", stamp);
        assert.deepStrictEqual(
          await Array.fromAsync(
            repository.findQuoteAuthorizationReferenceIdentifiers(stamp),
          ),
          ["other"],
        );
      } finally {
        await cleanup();
      }
    });

    test("serializes concurrent quote authorization inserts", async () => {
      const prefix = `botkit_test_${crypto.randomUUID()}`;
      const firstClient = createClient({ url: redisUrl });
      const secondClient = createClient({ url: redisUrl });
      await firstClient.connect();
      await secondClient.connect();
      const quote = new URL("https://remote.example/notes/raced-quote");
      const state: DelayedGetState = { count: 0, waiters: [] };
      const indexKey = [
        prefix,
        "bots",
        "bot",
        "quoteAuthorizationsByInteractingObject",
        encodeURIComponent(quote.href),
      ].join(":");
      const firstRepository = new RedisRepository({
        client: createDelayedGetClient(firstClient, indexKey, state),
        prefix,
      });
      const secondRepository = new RedisRepository({
        client: createDelayedGetClient(secondClient, indexKey, state),
        prefix,
      });
      try {
        const firstId = "01942976-3400-7f34-872e-2cbf0f9eeac6";
        const secondId = "01942976-3400-7f34-872e-2cbf0f9eeac7";
        const target = new URL("https://example.com/ap/note/1");
        const first = new QuoteAuthorization({
          id: new URL(
            `https://example.com/ap/actor/bot/quote-authorization/${firstId}`,
          ),
          attribution: new URL("https://example.com/ap/actor/bot"),
          interactingObject: quote,
          interactionTarget: target,
        });
        const second = new QuoteAuthorization({
          id: new URL(
            `https://example.com/ap/actor/bot/quote-authorization/${secondId}`,
          ),
          attribution: new URL("https://example.com/ap/actor/bot"),
          interactingObject: quote,
          interactionTarget: target,
        });

        await Promise.all([
          firstRepository.addQuoteAuthorization("bot", firstId, first),
          secondRepository.addQuoteAuthorization("bot", secondId, second),
        ]);

        const found = await firstRepository.findQuoteAuthorization(
          "bot",
          quote,
        );
        const stored = (await Promise.all([
          firstRepository.getQuoteAuthorization("bot", firstId),
          firstRepository.getQuoteAuthorization("bot", secondId),
        ])).filter((authorization) => authorization != null);
        assert.deepStrictEqual(stored.length, 1);
        assert.deepStrictEqual(found?.id?.href, stored[0].id?.href);
      } finally {
        await firstRepository.close();
        await secondRepository.close();
        await firstClient.quit();
        await secondClient.quit();
        await cleanupPrefix(redisUrl, prefix);
      }
    });

    test("preserves quote authorization indexes during stale cleanup", async () => {
      const prefix = `botkit_test_${crypto.randomUUID()}`;
      const setupClient = createClient({ url: redisUrl });
      const findClient = createClient({ url: redisUrl });
      await setupClient.connect();
      await findClient.connect();
      const quote = new URL("https://remote.example/notes/cleanup-race");
      const indexKey = [
        prefix,
        "bots",
        "bot",
        "quoteAuthorizationsByInteractingObject",
        encodeURIComponent(quote.href),
      ].join(":");
      const observed = createDeferred();
      const release = createDeferred();
      const findRepository = new RedisRepository({
        client: createDelayedDeleteClient(
          findClient,
          indexKey,
          observed,
          release,
        ),
        prefix,
      });
      const addRepository = new RedisRepository({ url: redisUrl, prefix });
      try {
        const id = "01942976-3400-7f34-872e-2cbf0f9eeac8";
        const staleId = "01942976-3400-7f34-872e-2cbf0f9eeac9";
        const authorization = new QuoteAuthorization({
          id: new URL(
            `https://example.com/ap/actor/bot/quote-authorization/${id}`,
          ),
          attribution: new URL("https://example.com/ap/actor/bot"),
          interactingObject: quote,
          interactionTarget: new URL("https://example.com/ap/note/1"),
        });
        await setupClient.sendCommand(["SET", indexKey, staleId]);

        const findPromise = findRepository.findQuoteAuthorization("bot", quote);
        await observed.promise;
        const addPromise = addRepository.addQuoteAuthorization(
          "bot",
          id,
          authorization,
        );
        await delay(50);
        release.resolve();

        assert.deepStrictEqual(await findPromise, undefined);
        await addPromise;
        assert.deepStrictEqual(
          (await addRepository.findQuoteAuthorization("bot", quote))?.id?.href,
          authorization.id?.href,
        );
      } finally {
        release.resolve();
        await findRepository.close();
        await addRepository.close();
        await setupClient.quit();
        await findClient.quit();
        await cleanupPrefix(redisUrl, prefix);
      }
    });
  });
}
