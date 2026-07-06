// BotKit by Fedify: A framework for creating ActivityPub bots
// Copyright (C) 2025–2026 Hong Minhee <https://hongminhee.org/>
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
import { type InboxContext, MemoryKvStore } from "@fedify/fedify/federation";
import {
  Create,
  Follow,
  Note,
  Person,
  PUBLIC_COLLECTION,
  QuoteRequest,
} from "@fedify/vocab";
import assert from "node:assert";
import { describe, test } from "node:test";
import { InstanceImpl } from "./instance-impl.ts";
import type { BotProfile } from "./instance.ts";
import { MemoryRepository } from "./repository.ts";
import { text } from "./text.ts";

function createInstance(): {
  instance: InstanceImpl<void>;
  repository: MemoryRepository;
} {
  const repository = new MemoryRepository();
  const instance = new InstanceImpl<void>({
    kv: new MemoryKvStore(),
    repository,
  });
  return { instance, repository };
}

function regionProfile(identifier: string): BotProfile<void> | null {
  if (!identifier.startsWith("region_")) return null;
  const region = identifier.slice("region_".length);
  return {
    username: identifier,
    name: `${region.toUpperCase()} Weather Bot`,
  };
}

describe("dynamic bots", () => {
  test("serve dispatcher-resolved actors", async () => {
    const { instance } = createInstance();
    let calls = 0;
    instance.createBot((_ctx, identifier) => {
      calls++;
      return regionProfile(identifier);
    });
    const response = await instance.fetch(
      new Request("https://example.com/ap/actor/region_kr", {
        headers: { Accept: "application/activity+json" },
      }),
      undefined,
    );
    assert.deepStrictEqual(response.status, 200);
    const actor = await response.json();
    assert.deepStrictEqual(actor.preferredUsername, "region_kr");
    assert.deepStrictEqual(actor.name, "KR Weather Bot");

    const miss = await instance.fetch(
      new Request("https://example.com/ap/actor/other", {
        headers: { Accept: "application/activity+json" },
      }),
      undefined,
    );
    assert.deepStrictEqual(miss.status, 404);

    // Resolution is memoized per context, so a dispatcher runs at most
    // once per identifier within one context:
    calls = 0;
    const ctx = instance.federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    await instance.resolveBot(ctx, "region_kr");
    await instance.resolveBot(ctx, "region_kr");
    await instance.resolveBot(ctx, "other");
    await instance.resolveBot(ctx, "other");
    assert.deepStrictEqual(calls, 2);
  });

  test("prefer static bots over dynamic dispatchers", async () => {
    const { instance } = createInstance();
    instance.createBot("region_kr", { username: "static-kr" });
    instance.createBot((_ctx, identifier) => regionProfile(identifier));
    const response = await instance.fetch(
      new Request("https://example.com/ap/actor/region_kr", {
        headers: { Accept: "application/activity+json" },
      }),
      undefined,
    );
    assert.deepStrictEqual(response.status, 200);
    const actor = await response.json();
    assert.deepStrictEqual(actor.preferredUsername, "static-kr");
  });

  test("probe dispatchers in registration order", async () => {
    const { instance } = createInstance();
    const probed: string[] = [];
    instance.createBot((_ctx, identifier) => {
      probed.push("first");
      return identifier === "dual" ? { username: "first-bot" } : null;
    });
    instance.createBot((_ctx, identifier) => {
      probed.push("second");
      return identifier === "dual" ? { username: "second-bot" } : null;
    });
    const response = await instance.fetch(
      new Request("https://example.com/ap/actor/dual", {
        headers: { Accept: "application/activity+json" },
      }),
      undefined,
    );
    const actor = await response.json();
    assert.deepStrictEqual(actor.preferredUsername, "first-bot");
    assert.ok(!probed.includes("second"));
  });

  test("fall through to the next dispatcher on null", async () => {
    const { instance } = createInstance();
    const probed: string[] = [];
    instance.createBot((_ctx, identifier) => {
      probed.push("first");
      return identifier === "somebody-else" ? { username: "first-bot" } : null;
    });
    instance.createBot((_ctx, identifier) => {
      probed.push("second");
      return regionProfile(identifier);
    });
    const response = await instance.fetch(
      new Request("https://example.com/ap/actor/region_kr", {
        headers: { Accept: "application/activity+json" },
      }),
      undefined,
    );
    assert.deepStrictEqual(response.status, 200);
    const actor = await response.json();
    assert.deepStrictEqual(actor.preferredUsername, "region_kr");
    // The first dispatcher was probed, returned null, and the resolution
    // fell through to the second:
    assert.ok(probed.includes("first"));
    assert.ok(probed.includes("second"));
  });

  test("read event handlers live from the group", async () => {
    const { instance } = createInstance();
    const group = instance.createBot(
      (_ctx, identifier) => regionProfile(identifier),
    );
    // Resolve the bot once before any handler is registered:
    await instance.fetch(
      new Request("https://example.com/ap/actor/region_kr", {
        headers: { Accept: "application/activity+json" },
      }),
      undefined,
    );
    // A handler registered afterwards must still fire:
    const followed: string[] = [];
    group.onFollow = (session) => void (followed.push(session.bot.identifier));
    const ctx = instance.federation.createContext(
      new URL("https://example.com/"),
      undefined,
    ) as InboxContext<void>;
    Object.defineProperty(ctx, "recipient", {
      value: null,
      configurable: true,
    });
    Object.defineProperty(ctx, "sendActivity", {
      value: () => Promise.resolve(),
      configurable: true,
    });
    await instance.onFollowed(
      ctx,
      new Follow({
        id: new URL("https://remote.example/follows/1"),
        actor: new Person({
          id: new URL("https://remote.example/actors/john"),
          preferredUsername: "john",
        }),
        object: new URL("https://example.com/ap/actor/region_kr"),
      }),
    );
    assert.deepStrictEqual(followed, ["region_kr"]);
  });

  test("resolve usernames through mapUsername", async () => {
    const { instance } = createInstance();
    instance.createBot(
      (_ctx, identifier) => regionProfile(identifier),
      {
        mapUsername: (_ctx, username) =>
          username.startsWith("region_") ? username : `region_${username}`,
      },
    );
    const response = await instance.fetch(
      new Request(
        "https://example.com/.well-known/webfinger?resource=acct:kr@example.com",
      ),
      undefined,
    );
    assert.deepStrictEqual(response.status, 200);
    const jrd = await response.json();
    const self = jrd.links.find((link: { rel: string }) => link.rel === "self");
    assert.deepStrictEqual(
      self.href,
      "https://example.com/ap/actor/region_kr",
    );
  });

  test("fall back to username-as-identifier lookups", async () => {
    const { instance } = createInstance();
    instance.createBot((_ctx, identifier) => regionProfile(identifier));
    const response = await instance.fetch(
      new Request(
        "https://example.com/.well-known/webfinger?resource=acct:region_kr@example.com",
      ),
      undefined,
    );
    assert.deepStrictEqual(response.status, 200);
  });

  test("require context data unless TContextData is void", () => {
    const instance = new InstanceImpl<{ db: string }>({
      kv: new MemoryKvStore(),
      repository: new MemoryRepository(),
    });
    const group = instance.createBot((_ctx, identifier) => ({
      username: identifier,
    }));
    // @ts-expect-error: contextData is required when TContextData is not
    // void.
    group.getSession("https://example.com", "someone").catch(() => {});
    group.getSession("https://example.com", "someone", { db: "x" })
      .catch(() => {});
  });

  test("create sessions for resolved identifiers", async () => {
    const { instance } = createInstance();
    const group = instance.createBot(
      (_ctx, identifier) => regionProfile(identifier),
    );
    const session = await group.getSession(
      "https://example.com",
      "region_kr",
    );
    assert.deepStrictEqual(
      session.actorId.href,
      "https://example.com/ap/actor/region_kr",
    );
    assert.deepStrictEqual(session.bot.identifier, "region_kr");
    assert.deepStrictEqual(session.bot.username, "region_kr");

    await assert.rejects(
      () => group.getSession("https://example.com", "nonexistent"),
      TypeError,
    );
  });
});

describe("dynamic bots in routing and web pages", () => {
  test("receive quote requests for their messages", async () => {
    const { instance, repository } = createInstance();
    const group = instance.createBot(
      (_ctx, identifier) => regionProfile(identifier),
    );
    const events: string[] = [];
    group.onQuoteRequest = (session, request) => {
      events.push(`${session.bot.identifier}:${request.state}`);
    };
    const ctx = instance.federation.createContext(
      new URL("https://example.com/"),
      undefined,
    ) as InboxContext<void>;
    Object.defineProperty(ctx, "recipient", {
      value: null,
      configurable: true,
    });
    Object.defineProperty(ctx, "sendActivity", {
      value: () => Promise.resolve(),
      configurable: true,
    });
    const bot = await instance.resolveBot(ctx, "region_kr");
    assert.ok(bot != null);
    const target = await bot.getSession(ctx).publish(text`Quote me`);
    const actor = new Person({
      id: new URL("https://remote.example/users/alice"),
      preferredUsername: "alice",
    });
    const quote = new Note({
      id: new URL("https://remote.example/notes/quote"),
      attribution: actor,
      quoteUrl: target.id,
      content: "Quoted.",
      to: PUBLIC_COLLECTION,
    });

    await instance.onQuoteRequested(
      ctx,
      new QuoteRequest({
        id: new URL("https://remote.example/quote-requests/1"),
        actor,
        object: target.id,
        instrument: quote,
      }),
    );

    assert.deepStrictEqual(events, ["region_kr:accepted"]);
    assert.deepStrictEqual(
      (await repository.findQuoteAuthorization("region_kr", quote.id!))
        ?.interactionTargetId,
      target.id,
    );
  });

  test("receive timeline messages via followees", async () => {
    const { instance, repository } = createInstance();
    const group = instance.createBot(
      (_ctx, identifier) => regionProfile(identifier),
    );
    const events: string[] = [];
    group.onMessage = (session) =>
      void (events.push(`message:${session.bot.identifier}`));
    const author = new Person({
      id: new URL("https://example.com/ap/actor/john"),
      preferredUsername: "john",
    });
    await repository.addFollowee(
      "region_kr",
      author.id!,
      new Follow({
        id: new URL(
          "https://example.com/ap/actor/region_kr/follow/e35ff5d8-ede9-4f5e-9b83-4bfcd4c9a69c",
        ),
        actor: new URL("https://example.com/ap/actor/region_kr"),
        object: author.id!,
      }),
    );
    const ctx = instance.federation.createContext(
      new URL("https://example.com/"),
      undefined,
    ) as InboxContext<void>;
    Object.defineProperty(ctx, "recipient", {
      value: null,
      configurable: true,
    });
    await instance.onCreated(
      ctx,
      new Create({
        id: new URL("https://remote.example/creates/1"),
        actor: author,
        to: PUBLIC_COLLECTION,
        object: new Note({
          id: new URL("https://remote.example/notes/1"),
          attribution: author,
          to: PUBLIC_COLLECTION,
          content: "A timeline post",
        }),
      }),
    );
    assert.deepStrictEqual(events, ["message:region_kr"]);
  });

  test("serve dynamic bots' web pages", async () => {
    const { instance } = createInstance();
    instance.createBot((_ctx, identifier) => regionProfile(identifier));
    const response = await instance.fetch(
      new Request("https://example.com/@region_kr"),
      undefined,
    );
    assert.deepStrictEqual(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("@region_kr@example.com"));

    const miss = await instance.fetch(
      new Request("https://example.com/@nonexistent"),
      undefined,
    );
    assert.deepStrictEqual(miss.status, 404);
  });
});

describe("mapUsername ownership", () => {
  test("cannot map usernames to other bots' identifiers", async () => {
    const { instance } = createInstance();
    instance.createBot("staticbot", { username: "staticbot" });
    instance.createBot(
      (_ctx, identifier) => regionProfile(identifier),
      {
        // A hostile or buggy mapping pointing at a static bot's identifier:
        mapUsername: () => "staticbot",
      },
    );
    const response = await instance.fetch(
      new Request(
        "https://example.com/.well-known/webfinger?resource=acct:hijack@example.com",
      ),
      undefined,
    );
    assert.deepStrictEqual(response.status, 404);
  });
});

describe("username-as-identifier fallback scope", () => {
  test("does not expose static bots' internal identifiers", async () => {
    const { instance } = createInstance();
    instance.createBot("internal", { username: "mybot" });
    const response = await instance.fetch(
      new Request(
        "https://example.com/.well-known/webfinger?resource=acct:internal@example.com",
      ),
      undefined,
    );
    assert.deepStrictEqual(response.status, 404);
  });
});
