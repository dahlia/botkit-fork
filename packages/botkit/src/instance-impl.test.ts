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
import { MemoryKvStore } from "@fedify/fedify/federation";
import { Create, Note } from "@fedify/vocab";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createInstance } from "./instance.ts";
import { MemoryRepository } from "./repository.ts";
import { text } from "./text.ts";

describe("createInstance()", () => {
  test("serves a static bot's actor", async () => {
    const instance = createInstance<void>({ kv: new MemoryKvStore() });
    const bot = instance.createBot("bot", {
      username: "mybot",
      name: "My Bot",
    });
    assert.deepStrictEqual(bot.identifier, "bot");

    const response = await instance.fetch(
      new Request("https://example.com/ap/actor/bot", {
        headers: { Accept: "application/activity+json" },
      }),
    );
    assert.deepStrictEqual(response.status, 200);
    const actor = await response.json();
    assert.deepStrictEqual(actor.preferredUsername, "mybot");
    assert.deepStrictEqual(actor.name, "My Bot");
  });

  test("serves WebFinger for a static bot", async () => {
    const instance = createInstance<void>({ kv: new MemoryKvStore() });
    instance.createBot("bot", { username: "mybot" });
    const response = await instance.fetch(
      new Request(
        "https://example.com/.well-known/webfinger?resource=acct:mybot@example.com",
      ),
    );
    assert.deepStrictEqual(response.status, 200);
    const jrd = await response.json();
    assert.deepStrictEqual(jrd.subject, "acct:mybot@example.com");
  });

  test("passes quotePolicy to a static bot", async () => {
    const repository = new MemoryRepository();
    const instance = createInstance<void>({
      kv: new MemoryKvStore(),
      repository,
    });
    const bot = instance.createBot("bot", {
      username: "mybot",
      quotePolicy: "nobody",
    });
    const session = bot.getSession("https://example.com");

    await session.publish(text`Nobody can quote this.`);

    const messages = [];
    for await (const message of repository.getMessages("bot")) {
      messages.push(message);
    }
    assert.deepStrictEqual(messages.length, 1);
    const activity = messages[0];
    assert.ok(activity instanceof Create);
    const object = await activity.getObject(session.context);
    assert.ok(object instanceof Note);
    assert.deepStrictEqual(
      object.interactionPolicy?.canQuote?.automaticApprovals,
      [session.actorId],
    );
  });

  test("returns 404 for unregistered identifiers", async () => {
    const instance = createInstance<void>({ kv: new MemoryKvStore() });
    instance.createBot("bot", { username: "mybot" });
    const response = await instance.fetch(
      new Request("https://example.com/ap/actor/nonexistent", {
        headers: { Accept: "application/activity+json" },
      }),
    );
    assert.deepStrictEqual(response.status, 404);
  });

  test("rejects duplicate identifiers and usernames", () => {
    const instance = createInstance<void>({ kv: new MemoryKvStore() });
    instance.createBot("bot", { username: "mybot" });
    assert.throws(
      () => instance.createBot("bot", { username: "other" }),
      TypeError,
    );
    assert.throws(
      () => instance.createBot("other", { username: "mybot" }),
      TypeError,
    );
  });

  test("rejects usernames that differ only in case", () => {
    const instance = createInstance<void>({ kv: new MemoryKvStore() });
    instance.createBot("bot", { username: "mybot" });
    // Fediverse usernames are matched case-insensitively (WebFinger acct:
    // lookups and mentions vary in casing), so two bots whose usernames
    // differ only in case would be indistinguishable:
    assert.throws(
      () => instance.createBot("other", { username: "MyBot" }),
      TypeError,
    );
  });

  test("serves WebFinger regardless of the username casing", async () => {
    const instance = createInstance<void>({ kv: new MemoryKvStore() });
    instance.createBot("bot", { username: "mybot" });
    const response = await instance.fetch(
      new Request(
        "https://example.com/.well-known/webfinger?resource=acct:MyBot@example.com",
      ),
    );
    assert.deepStrictEqual(response.status, 200);
  });

  test("registers event handlers through the returned bot", () => {
    const instance = createInstance<void>({ kv: new MemoryKvStore() });
    const bot = instance.createBot("bot", { username: "mybot" });
    const handler = () => {};
    bot.onMention = handler;
    assert.deepStrictEqual(bot.onMention, handler);
  });

  test("creates sessions for a static bot", () => {
    const instance = createInstance<void>({ kv: new MemoryKvStore() });
    const bot = instance.createBot("bot", { username: "mybot" });
    const session = bot.getSession("https://example.com");
    assert.deepStrictEqual(
      session.actorId.href,
      "https://example.com/ap/actor/bot",
    );
    assert.deepStrictEqual(session.actorHandle, "@mybot@example.com");
    assert.deepStrictEqual(session.bot.identifier, "bot");
    assert.deepStrictEqual(session.bot.username, "mybot");
  });

  test("does not redirect legacy URIs without legacyObjectUris", async () => {
    const instance = createInstance<void>({ kv: new MemoryKvStore() });
    instance.createBot("bot", { username: "mybot" });
    const response = await instance.fetch(
      new Request("https://example.com/ap/note/123"),
    );
    assert.notDeepStrictEqual(response.status, 301);
  });

  test("redirects legacy URIs with legacyObjectUris", async () => {
    const instance = createInstance<void>({
      kv: new MemoryKvStore(),
      legacyObjectUris: { identifier: "bot" },
    });
    instance.createBot("bot", { username: "mybot" });
    const response = await instance.fetch(
      new Request("https://example.com/ap/note/123"),
    );
    assert.deepStrictEqual(response.status, 301);
    assert.deepStrictEqual(
      response.headers.get("Location"),
      "https://example.com/ap/actor/bot/note/123",
    );
  });

  test("defines custom emojis at the instance level", () => {
    const instance = createInstance<void>({ kv: new MemoryKvStore() });
    const emojis = instance.addCustomEmojis({
      wave: {
        type: "image/png",
        url: "https://example.com/emojis/wave.png",
      },
    });
    assert.ok("wave" in emojis);
    assert.throws(
      () =>
        instance.addCustomEmojis({
          wave: {
            type: "image/png",
            url: "https://example.com/emojis/wave2.png",
          },
        }),
      TypeError,
    );
  });
});
