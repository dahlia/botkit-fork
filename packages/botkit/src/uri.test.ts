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
import {
  Announce,
  Article,
  ChatMessage,
  Create,
  Follow,
  Note,
  Question,
} from "@fedify/vocab";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BotImpl } from "./bot-impl.ts";
import { parseLocalUri, rewriteLegacyObjectPath } from "./uri.ts";

describe("rewriteLegacyObjectPath()", () => {
  test("rewrites legacy object paths", () => {
    assert.deepStrictEqual(
      rewriteLegacyObjectPath(
        "/ap/follow/03a395a2-353a-4894-afdb-2cab31a7b004",
        "bot",
      ),
      "/ap/actor/bot/follow/03a395a2-353a-4894-afdb-2cab31a7b004",
    );
    for (
      const type of [
        "follow",
        "create",
        "article",
        "chat-message",
        "note",
        "question",
        "announce",
      ]
    ) {
      assert.deepStrictEqual(
        rewriteLegacyObjectPath(`/ap/${type}/123`, "my-bot"),
        `/ap/actor/my-bot/${type}/123`,
      );
    }
  });

  test("percent-encodes the identifier", () => {
    assert.deepStrictEqual(
      rewriteLegacyObjectPath("/ap/note/123", "b/t"),
      "/ap/actor/b%2Ft/note/123",
    );
  });

  test("returns null for non-legacy paths", () => {
    assert.deepStrictEqual(
      rewriteLegacyObjectPath("/ap/actor/bot", "bot"),
      null,
    );
    assert.deepStrictEqual(
      rewriteLegacyObjectPath("/ap/actor/bot/note/123", "bot"),
      null,
    );
    assert.deepStrictEqual(
      rewriteLegacyObjectPath("/ap/emoji/wave", "bot"),
      null,
    );
    assert.deepStrictEqual(rewriteLegacyObjectPath("/ap/inbox", "bot"), null);
    assert.deepStrictEqual(
      rewriteLegacyObjectPath("/message/123", "bot"),
      null,
    );
    assert.deepStrictEqual(
      rewriteLegacyObjectPath("/ap/note/123/extra", "bot"),
      null,
    );
  });
});

describe("parseLocalUri()", () => {
  const bot = new BotImpl<void>({
    kv: new MemoryKvStore(),
    username: "bot",
  });
  const ctx = bot.federation.createContext(new URL("https://example.com/"));

  test("behaves like Context.parseUri() for canonical URIs", () => {
    const actorUri = new URL("https://example.com/ap/actor/bot");
    assert.deepStrictEqual(
      parseLocalUri(ctx, actorUri, "bot"),
      ctx.parseUri(actorUri),
    );
    const noteUri = new URL(
      "https://example.com/ap/actor/bot/note/01941f29-7c00-7fe8-ab0a-7b593990a3c0",
    );
    const parsed = parseLocalUri(ctx, noteUri, "bot");
    assert.ok(parsed != null);
    assert.deepStrictEqual(parsed.type, "object");
    assert.ok(parsed.type === "object");
    assert.deepStrictEqual(parsed.class, Note);
    assert.deepStrictEqual(parsed.values, {
      identifier: "bot",
      id: "01941f29-7c00-7fe8-ab0a-7b593990a3c0",
    });
  });

  test("recognizes legacy object URIs when a legacy identifier is given", () => {
    const classes = {
      follow: Follow,
      create: Create,
      article: Article,
      "chat-message": ChatMessage,
      note: Note,
      question: Question,
      announce: Announce,
    } as const;
    for (const [type, cls] of Object.entries(classes)) {
      const legacyUri = new URL(
        `https://example.com/ap/${type}/01941f29-7c00-7fe8-ab0a-7b593990a3c0`,
      );
      const parsed = parseLocalUri(ctx, legacyUri, "bot");
      assert.ok(parsed != null, `legacy ${type} URI should parse`);
      assert.deepStrictEqual(parsed.type, "object");
      assert.ok(parsed.type === "object");
      assert.deepStrictEqual(parsed.class, cls);
      assert.deepStrictEqual(parsed.values, {
        identifier: "bot",
        id: "01941f29-7c00-7fe8-ab0a-7b593990a3c0",
      });
    }
  });

  test("does not recognize legacy URIs without a legacy identifier", () => {
    const legacyUri = new URL(
      "https://example.com/ap/note/01941f29-7c00-7fe8-ab0a-7b593990a3c0",
    );
    assert.deepStrictEqual(parseLocalUri(ctx, legacyUri), null);
  });

  test("returns null for null and foreign URIs", () => {
    assert.deepStrictEqual(parseLocalUri(ctx, null, "bot"), null);
    assert.deepStrictEqual(
      parseLocalUri(
        ctx,
        new URL("https://other.example/ap/note/123"),
        "bot",
      ),
      null,
    );
    assert.deepStrictEqual(
      parseLocalUri(ctx, new URL("https://example.com/unrelated"), "bot"),
      null,
    );
  });
});
