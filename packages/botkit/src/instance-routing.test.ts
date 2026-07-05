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
  Accept,
  Create,
  Follow,
  Like as RawLike,
  Mention,
  Note,
  Person,
  PUBLIC_COLLECTION,
  Undo,
} from "@fedify/vocab";
import assert from "node:assert";
import { describe, test } from "node:test";
import type { Bot } from "./bot.ts";
import { BotImpl } from "./bot-impl.ts";
import { InstanceImpl } from "./instance-impl.ts";
import { MemoryRepository, type Uuid } from "./repository.ts";

function createMockInboxContext<TContextData>(
  instance: InstanceImpl<TContextData>,
  origin: string | URL,
  contextData: TContextData,
  recipient?: string | null,
): InboxContext<TContextData> {
  const ctx = instance.federation.createContext(
    new URL(origin),
    contextData,
  ) as InboxContext<TContextData>;
  Object.defineProperty(ctx, "recipient", {
    value: recipient ?? null,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(ctx, "sendActivity", {
    value: () => Promise.resolve(),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(ctx, "forwardActivity", {
    value: () => Promise.resolve(),
    writable: true,
    configurable: true,
  });
  return ctx;
}

interface Harness {
  readonly instance: InstanceImpl<void>;
  readonly repository: MemoryRepository;
  readonly alpha: Bot<void>;
  readonly beta: Bot<void>;
  readonly ctx: InboxContext<void>;
}

function createHarness(): Harness {
  const repository = new MemoryRepository();
  const instance = new InstanceImpl<void>({
    kv: new MemoryKvStore(),
    repository,
  });
  const alpha = instance.createBot("alpha", { username: "alphabot" });
  const beta = instance.createBot("beta", { username: "betabot" });
  const ctx = createMockInboxContext(
    instance,
    "https://example.com/",
    undefined,
  );
  return { instance, repository, alpha, beta, ctx };
}

function remotePerson(handle: string): Person {
  return new Person({
    id: new URL(`https://example.com/ap/actor/${handle}`),
    preferredUsername: handle,
  });
}

describe("shared inbox routing", () => {
  test("routes Follow to the followed bot only", async () => {
    const { instance, alpha, beta, ctx } = createHarness();
    const followed: string[] = [];
    alpha.onFollow = (session) => void (followed.push(session.bot.identifier));
    beta.onFollow = (session) => void (followed.push(session.bot.identifier));
    await instance.onFollowed(
      ctx,
      new Follow({
        id: new URL("https://remote.example/follows/1"),
        actor: remotePerson("john"),
        object: new URL("https://example.com/ap/actor/alpha"),
      }),
    );
    assert.deepStrictEqual(followed, ["alpha"]);
  });

  test("routes Accept to the bot that sent the follow", async () => {
    const { instance, repository, alpha, beta, ctx } = createHarness();
    const accepted: string[] = [];
    alpha.onAcceptFollow = (session) =>
      void (accepted.push(session.bot.identifier));
    beta.onAcceptFollow = (session) =>
      void (accepted.push(session.bot.identifier));
    const followId: Uuid = "9d952a10-77e6-46bd-a48a-208b47e5e2bb";
    await repository.addSentFollow(
      "alpha",
      followId,
      new Follow({
        id: new URL(
          `https://example.com/ap/actor/alpha/follow/${followId}`,
        ),
        actor: new URL("https://example.com/ap/actor/alpha"),
        object: remotePerson("john"),
      }),
    );
    await instance.onFollowAccepted(
      ctx,
      new Accept({
        actor: new URL("https://example.com/ap/actor/john"),
        object: new URL(
          `https://example.com/ap/actor/alpha/follow/${followId}`,
        ),
      }),
    );
    assert.deepStrictEqual(accepted, ["alpha"]);
  });

  test("routes Like to the bot owning the message", async () => {
    const { instance, repository, alpha, beta, ctx } = createHarness();
    const liked: string[] = [];
    alpha.onLike = (session) => void (liked.push(session.bot.identifier));
    beta.onLike = (session) => void (liked.push(session.bot.identifier));
    const messageId: Uuid = "01941f29-7c00-7fe8-ab0a-7b593990a3c0";
    await repository.addMessage(
      "alpha",
      messageId,
      new Create({
        id: new URL(
          `https://example.com/ap/actor/alpha/create/${messageId}`,
        ),
        actor: new URL("https://example.com/ap/actor/alpha"),
        to: PUBLIC_COLLECTION,
        object: new Note({
          id: new URL(
            `https://example.com/ap/actor/alpha/note/${messageId}`,
          ),
          attribution: new URL("https://example.com/ap/actor/alpha"),
          to: PUBLIC_COLLECTION,
          content: "Hello!",
        }),
      }),
    );
    await instance.onLiked(
      ctx,
      new RawLike({
        id: new URL("https://remote.example/likes/1"),
        actor: remotePerson("john"),
        object: new URL(
          `https://example.com/ap/actor/alpha/note/${messageId}`,
        ),
      }),
    );
    assert.deepStrictEqual(liked, ["alpha"]);
  });

  test("drops Like on objects the instance does not own", async () => {
    const { instance, alpha, beta, ctx } = createHarness();
    const liked: string[] = [];
    alpha.onLike = (session) => void (liked.push(session.bot.identifier));
    beta.onLike = (session) => void (liked.push(session.bot.identifier));
    await instance.onLiked(
      ctx,
      new RawLike({
        id: new URL("https://remote.example/likes/2"),
        actor: remotePerson("john"),
        object: new URL("https://remote.example/notes/1"),
      }),
    );
    assert.deepStrictEqual(liked, []);
  });

  test("ignores Like on another bot's local object", async () => {
    const { instance, alpha, beta } = createHarness();
    const liked: string[] = [];
    alpha.onLike = (session) => void (liked.push(session.bot.identifier));
    beta.onLike = (session) => void (liked.push(session.bot.identifier));
    // Delivered to beta's personal inbox, but the object is alpha's local
    // note (embedded, so no dereference is needed to see it):
    const ctx = createMockInboxContext(
      instance,
      "https://example.com/",
      undefined,
      "beta",
    );
    const messageId: Uuid = "01941f29-7c00-7fe8-ab0a-7b593990a3c1";
    await instance.onLiked(
      ctx,
      new RawLike({
        id: new URL("https://remote.example/likes/4"),
        actor: remotePerson("john"),
        object: new Note({
          id: new URL(
            `https://example.com/ap/actor/alpha/note/${messageId}`,
          ),
          attribution: new URL("https://example.com/ap/actor/alpha"),
          to: PUBLIC_COLLECTION,
          content: "Alpha's note",
        }),
      }),
    );
    assert.deepStrictEqual(liked, []);
  });

  test("ignores reactions on another bot's local object", async () => {
    const { instance, alpha, beta } = createHarness();
    const reacted: string[] = [];
    alpha.onReact = (session) => void (reacted.push(session.bot.identifier));
    beta.onReact = (session) => void (reacted.push(session.bot.identifier));
    const ctx = createMockInboxContext(
      instance,
      "https://example.com/",
      undefined,
      "beta",
    );
    const messageId: Uuid = "01941f29-7c00-7fe8-ab0a-7b593990a3c2";
    // A Like with a name is treated as an emoji reaction:
    await instance.onLiked(
      ctx,
      new RawLike({
        id: new URL("https://remote.example/reacts/1"),
        actor: remotePerson("john"),
        name: "👍",
        object: new Note({
          id: new URL(
            `https://example.com/ap/actor/alpha/note/${messageId}`,
          ),
          attribution: new URL("https://example.com/ap/actor/alpha"),
          to: PUBLIC_COLLECTION,
          content: "Alpha's note",
        }),
      }),
    );
    assert.deepStrictEqual(reacted, []);
  });

  test("routes Create replies to the replied bot", async () => {
    const { instance, repository, alpha, beta, ctx } = createHarness();
    const events: string[] = [];
    alpha.onReply = (session) =>
      void (events.push(`reply:${session.bot.identifier}`));
    beta.onReply = (session) =>
      void (events.push(`reply:${session.bot.identifier}`));
    beta.onMessage = (session) =>
      void (events.push(`message:${session.bot.identifier}`));

    const messageId: Uuid = "01941f29-7c00-7fe8-ab0a-7b593990a3c0";
    await repository.addMessage(
      "alpha",
      messageId,
      new Create({
        id: new URL(
          `https://example.com/ap/actor/alpha/create/${messageId}`,
        ),
        actor: new URL("https://example.com/ap/actor/alpha"),
        to: PUBLIC_COLLECTION,
        object: new Note({
          id: new URL(
            `https://example.com/ap/actor/alpha/note/${messageId}`,
          ),
          attribution: new URL("https://example.com/ap/actor/alpha"),
          to: PUBLIC_COLLECTION,
          content: "Original post",
        }),
      }),
    );

    const author = remotePerson("john");
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
          content: "A reply",
          replyTarget: new URL(
            `https://example.com/ap/actor/alpha/note/${messageId}`,
          ),
        }),
      }),
    );
    assert.deepStrictEqual(events, ["reply:alpha"]);
  });

  test("routes Create mentions to the mentioned bot", async () => {
    const { instance, alpha, beta, ctx } = createHarness();
    const events: string[] = [];
    alpha.onMention = (session) =>
      void (events.push(`mention:${session.bot.identifier}`));
    alpha.onMessage = (session) =>
      void (events.push(`message:${session.bot.identifier}`));
    beta.onMention = (session) =>
      void (events.push(`mention:${session.bot.identifier}`));

    const author = remotePerson("john");
    await instance.onCreated(
      ctx,
      new Create({
        id: new URL("https://remote.example/creates/2"),
        actor: author,
        to: PUBLIC_COLLECTION,
        object: new Note({
          id: new URL("https://remote.example/notes/2"),
          attribution: author,
          to: PUBLIC_COLLECTION,
          content: "Hello @betabot!",
          tags: [
            new Mention({
              href: new URL("https://example.com/ap/actor/beta"),
              name: "@betabot@example.com",
            }),
          ],
        }),
      }),
    );
    assert.deepStrictEqual(events, ["mention:beta"]);
  });

  test("routes Create to followers of the author", async () => {
    const { instance, repository, alpha, beta, ctx } = createHarness();
    const events: string[] = [];
    alpha.onMessage = (session) =>
      void (events.push(`message:${session.bot.identifier}`));
    beta.onMessage = (session) =>
      void (events.push(`message:${session.bot.identifier}`));

    const author = remotePerson("john");
    await repository.addFollowee(
      "alpha",
      author.id!,
      new Follow({
        id: new URL(
          "https://example.com/ap/actor/alpha/follow/e35ff5d8-ede9-4f5e-9b83-4bfcd4c9a69c",
        ),
        actor: new URL("https://example.com/ap/actor/alpha"),
        object: author.id!,
      }),
    );
    await instance.onCreated(
      ctx,
      new Create({
        id: new URL("https://remote.example/creates/5"),
        actor: author,
        to: PUBLIC_COLLECTION,
        object: new Note({
          id: new URL("https://remote.example/notes/5"),
          attribution: author,
          to: PUBLIC_COLLECTION,
          content: "Just a timeline post",
        }),
      }),
    );
    assert.deepStrictEqual(events, ["message:alpha"]);
  });

  test("routes Undo(Follow) to the unfollowed bot", async () => {
    const { instance, repository, alpha, beta, ctx } = createHarness();
    const unfollowed: string[] = [];
    alpha.onUnfollow = (session) =>
      void (unfollowed.push(session.bot.identifier));
    beta.onUnfollow = (session) =>
      void (unfollowed.push(session.bot.identifier));
    const follower = remotePerson("john");
    const followId = new URL("https://remote.example/follows/1");
    await repository.addFollower("alpha", followId, follower);
    await instance.onUndone(
      ctx,
      new Undo({
        actor: follower.id,
        object: new Follow({
          id: followId,
          actor: follower.id,
          object: new URL("https://example.com/ap/actor/alpha"),
        }),
      }),
    );
    assert.deepStrictEqual(unfollowed, ["alpha"]);
  });

  test("delivers personal inbox activities to the recipient only", async () => {
    const repository = new MemoryRepository();
    const instance = new InstanceImpl<void>({
      kv: new MemoryKvStore(),
      repository,
    });
    const alpha = instance.createBot("alpha", { username: "alphabot" });
    const beta = instance.createBot("beta", { username: "betabot" });
    const events: string[] = [];
    alpha.onMessage = (session) =>
      void (events.push(`message:${session.bot.identifier}`));
    beta.onMessage = (session) =>
      void (events.push(`message:${session.bot.identifier}`));
    const ctx = createMockInboxContext(
      instance,
      "https://example.com/",
      undefined,
      "beta",
    );
    const author = remotePerson("john");
    await instance.onCreated(
      ctx,
      new Create({
        id: new URL("https://remote.example/creates/3"),
        actor: author,
        to: PUBLIC_COLLECTION,
        object: new Note({
          id: new URL("https://remote.example/notes/3"),
          attribution: author,
          to: PUBLIC_COLLECTION,
          content: "Delivered to beta's personal inbox",
        }),
      }),
    );
    assert.deepStrictEqual(events, ["message:beta"]);
  });
});

describe("compatible single-bot instances", () => {
  test("fire onMessage for any incoming Create", async () => {
    const bot = new BotImpl<void>({
      kv: new MemoryKvStore(),
      repository: new MemoryRepository(),
      username: "bot",
    });
    const events: string[] = [];
    bot.onMessage = (session) =>
      void (events.push(`message:${session.bot.identifier}`));
    const ctx = createMockInboxContext(
      bot.instance,
      "https://example.com/",
      undefined,
    );
    const author = remotePerson("john");
    // The bot does not follow the author and is not addressed, but the
    // pre-0.5 behavior of a single-bot deployment is preserved:
    await bot.instance.onCreated(
      ctx,
      new Create({
        id: new URL("https://remote.example/creates/4"),
        actor: author,
        to: PUBLIC_COLLECTION,
        object: new Note({
          id: new URL("https://remote.example/notes/4"),
          attribution: author,
          to: PUBLIC_COLLECTION,
          content: "Unrelated post",
        }),
      }),
    );
    assert.deepStrictEqual(events, ["message:bot"]);
  });

  test("fire onLike for likes of objects with foreign URIs", async () => {
    const bot = new BotImpl<void>({
      kv: new MemoryKvStore(),
      repository: new MemoryRepository(),
      username: "bot",
    });
    const events: string[] = [];
    bot.onLike = (session) => void (events.push(session.bot.identifier));
    const ctx = createMockInboxContext(
      bot.instance,
      "https://example.com/",
      undefined,
    );
    await bot.instance.onLiked(
      ctx,
      new RawLike({
        id: new URL("https://remote.example/likes/3"),
        actor: new Person({
          id: new URL("https://example.com/ap/actor/bot"),
          preferredUsername: "bot",
        }),
        object: new Note({
          id: new URL("https://remote.example/notes/5"),
          attribution: new URL("https://example.com/ap/actor/bot"),
          to: PUBLIC_COLLECTION,
          content: "A note with a foreign URI",
        }),
      }),
    );
    assert.deepStrictEqual(events, ["bot"]);
  });
});

describe("addressed Create routing", () => {
  test("routes by the embedded object's addressing", async () => {
    const repository = new MemoryRepository();
    const instance = new InstanceImpl<void>({
      kv: new MemoryKvStore(),
      repository,
    });
    const alpha = instance.createBot("alpha", { username: "alphabot" });
    const beta = instance.createBot("beta", { username: "betabot" });
    const events: string[] = [];
    alpha.onMessage = (session) =>
      void (events.push(`message:${session.bot.identifier}`));
    beta.onMessage = (session) =>
      void (events.push(`message:${session.bot.identifier}`));
    const ctx = createMockInboxContext(
      instance,
      "https://example.com/",
      undefined,
    );
    const author = remotePerson("john");
    // The activity wrapper is public only; the audience is on the object:
    await instance.onCreated(
      ctx,
      new Create({
        id: new URL("https://remote.example/creates/6"),
        actor: author,
        to: PUBLIC_COLLECTION,
        object: new Note({
          id: new URL("https://remote.example/notes/6"),
          attribution: author,
          to: new URL("https://example.com/ap/actor/beta"),
          cc: PUBLIC_COLLECTION,
          content: "Addressed to beta on the object",
        }),
      }),
    );
    assert.deepStrictEqual(events, ["message:beta"]);
  });
});
