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
import { Create, Note, PUBLIC_COLLECTION } from "@fedify/vocab";
import assert from "node:assert";
import { describe, test } from "node:test";
import { BotImpl } from "./bot-impl.ts";
import { InstanceImpl } from "./instance-impl.ts";
import { MemoryRepository, type Uuid } from "./repository.ts";

const messageId: Uuid = "01941f29-7c00-7fe8-ab0a-7b593990a3c0";

async function seedMessage(
  repository: MemoryRepository,
  identifier: string,
): Promise<void> {
  await repository.addMessage(
    identifier,
    messageId,
    new Create({
      id: new URL(
        `https://example.com/ap/actor/${identifier}/create/${messageId}`,
      ),
      actor: new URL(`https://example.com/ap/actor/${identifier}`),
      to: PUBLIC_COLLECTION,
      object: new Note({
        id: new URL(
          `https://example.com/ap/actor/${identifier}/note/${messageId}`,
        ),
        attribution: new URL(`https://example.com/ap/actor/${identifier}`),
        to: PUBLIC_COLLECTION,
        content: "Hello, world!",
        published: Temporal.Instant.from("2025-01-01T00:00:00Z"),
      }),
      published: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    }),
  );
}

describe("single-bot web pages", () => {
  test("serve the bot at the web root", async () => {
    const repository = new MemoryRepository();
    const bot = new BotImpl<void>({
      kv: new MemoryKvStore(),
      repository,
      username: "mybot",
      name: "My Bot",
    });
    await seedMessage(repository, "bot");
    const profile = await bot.fetch(
      new Request("https://example.com/"),
      undefined,
    );
    assert.deepStrictEqual(profile.status, 200);
    const html = await profile.text();
    assert.ok(html.includes("@mybot@example.com"));
    assert.ok(html.includes('action="/follow"'));

    const message = await bot.fetch(
      new Request(`https://example.com/message/${messageId}`),
      undefined,
    );
    assert.deepStrictEqual(message.status, 200);

    const feed = await bot.fetch(
      new Request("https://example.com/feed.xml"),
      undefined,
    );
    assert.deepStrictEqual(feed.status, 200);
    assert.ok(
      feed.headers.get("Content-Type")?.startsWith("application/atom+xml"),
    );
  });

  test("use root-relative web URLs", () => {
    const bot = new BotImpl<void>({
      kv: new MemoryKvStore(),
      username: "mybot",
    });
    assert.deepStrictEqual(
      bot.instance.getBotWebUrl(bot, "https://example.com").href,
      "https://example.com/",
    );
    assert.deepStrictEqual(
      bot.instance.getMessageWebUrl(bot, messageId, "https://example.com")
        .href,
      `https://example.com/message/${messageId}`,
    );
  });
});

describe("multi-bot web pages", () => {
  function createInstanceWithBots(): {
    instance: InstanceImpl<void>;
    repository: MemoryRepository;
  } {
    const repository = new MemoryRepository();
    const instance = new InstanceImpl<void>({
      kv: new MemoryKvStore(),
      repository,
    });
    instance.createBot("alpha", { username: "alphabot", name: "Alpha" });
    instance.createBot("beta", { username: "betabot", name: "Beta" });
    return { instance, repository };
  }

  test("list the hosted bots at the web root", async () => {
    const { instance } = createInstanceWithBots();
    const response = await instance.fetch(
      new Request("https://example.com/"),
      undefined,
    );
    assert.deepStrictEqual(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("@alphabot@example.com"));
    assert.ok(html.includes("@betabot@example.com"));
    assert.ok(html.includes('href="/@alphabot"'));
  });

  test("serve per-bot profiles under /@{username}", async () => {
    const { instance } = createInstanceWithBots();
    const response = await instance.fetch(
      new Request("https://example.com/@alphabot"),
      undefined,
    );
    assert.deepStrictEqual(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("@alphabot@example.com"));
    assert.ok(html.includes('action="/@alphabot/follow"'));
    assert.ok(!html.includes("@betabot@example.com"));

    const unknown = await instance.fetch(
      new Request("https://example.com/@nobody"),
      undefined,
    );
    assert.deepStrictEqual(unknown.status, 404);
  });

  test("serve per-bot message permalinks and feeds", async () => {
    const { instance, repository } = createInstanceWithBots();
    await seedMessage(repository, "alpha");

    const message = await instance.fetch(
      new Request(`https://example.com/@alphabot/${messageId}`),
      undefined,
    );
    assert.deepStrictEqual(message.status, 200);

    // Another bot's path must not serve the message:
    const cross = await instance.fetch(
      new Request(`https://example.com/@betabot/${messageId}`),
      undefined,
    );
    assert.deepStrictEqual(cross.status, 404);

    const feed = await instance.fetch(
      new Request("https://example.com/@alphabot/feed.xml"),
      undefined,
    );
    assert.deepStrictEqual(feed.status, 200);
    assert.ok(
      feed.headers.get("Content-Type")?.startsWith("application/atom+xml"),
    );
    const followers = await instance.fetch(
      new Request("https://example.com/@alphabot/followers"),
      undefined,
    );
    assert.deepStrictEqual(followers.status, 200);
  });

  test("use username-based web URLs", () => {
    const { instance } = createInstanceWithBots();
    const alpha = instance.getBot("alpha")!;
    assert.deepStrictEqual(
      instance.getBotWebUrl(alpha, "https://example.com").href,
      "https://example.com/@alphabot",
    );
    assert.deepStrictEqual(
      instance.getMessageWebUrl(alpha, messageId, "https://example.com").href,
      `https://example.com/@alphabot/${messageId}`,
    );
  });

  test("advertise the web URL on the actor", async () => {
    const { instance } = createInstanceWithBots();
    const response = await instance.fetch(
      new Request("https://example.com/ap/actor/alpha", {
        headers: { Accept: "application/activity+json" },
      }),
      undefined,
    );
    assert.deepStrictEqual(response.status, 200);
    const actor = await response.json();
    assert.deepStrictEqual(actor.url, "https://example.com/@alphabot");
  });
});

describe("usernames requiring percent-encoding", () => {
  test("keep web paths and routes consistent", async () => {
    const instance = new InstanceImpl<void>({
      kv: new MemoryKvStore(),
      repository: new MemoryRepository(),
    });
    instance.createBot("alpha", { username: "weird+bot" });
    instance.createBot("beta", { username: "betabot" });
    const alpha = instance.getBot("alpha")!;
    const url = instance.getBotWebUrl(alpha, "https://example.com");
    assert.deepStrictEqual(url.href, "https://example.com/@weird%2Bbot");
    const response = await instance.fetch(new Request(url), undefined);
    assert.deepStrictEqual(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("weird+bot"));
  });
});
