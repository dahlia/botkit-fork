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
import { InteractionRule, PUBLIC_COLLECTION } from "@fedify/vocab";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  normalizeQuotePolicy,
  parseQuotePolicy,
  serializeQuotePolicy,
} from "./quote.ts";

describe("normalizeQuotePolicy()", () => {
  test("normalizes string policies", () => {
    assert.deepStrictEqual(normalizeQuotePolicy(), { automatic: "public" });
    assert.deepStrictEqual(normalizeQuotePolicy("public"), {
      automatic: "public",
    });
    assert.deepStrictEqual(normalizeQuotePolicy("followers"), {
      automatic: "followers",
    });
    assert.deepStrictEqual(normalizeQuotePolicy("nobody"), {
      automatic: "nobody",
    });
    assert.deepStrictEqual(normalizeQuotePolicy("manual"), {
      manual: "public",
    });
  });

  test("preserves object policies", () => {
    assert.deepStrictEqual(
      normalizeQuotePolicy({ automatic: "followers", manual: "public" }),
      { automatic: "followers", manual: "public" },
    );
  });
});

describe("serializeQuotePolicy()", () => {
  const actor = new URL("https://example.com/ap/actor/bot");
  const followers = new URL("https://example.com/ap/actor/bot/followers");

  test("serializes public automatic approval", () => {
    const rule = serializeQuotePolicy("public", actor, followers).canQuote;
    assert.deepStrictEqual(rule?.automaticApprovals, [PUBLIC_COLLECTION]);
    assert.deepStrictEqual(rule?.manualApprovals, []);
  });

  test("serializes followers automatic approval", () => {
    const rule = serializeQuotePolicy("followers", actor, followers).canQuote;
    assert.deepStrictEqual(rule?.automaticApprovals, [actor, followers]);
    assert.deepStrictEqual(rule?.manualApprovals, []);
  });

  test("serializes nobody automatic approval as actor-only", () => {
    const rule = serializeQuotePolicy("nobody", actor, followers).canQuote;
    assert.deepStrictEqual(rule?.automaticApprovals, [actor]);
    assert.deepStrictEqual(rule?.manualApprovals, []);
  });

  test("serializes manual followers approval", () => {
    const rule = serializeQuotePolicy(
      { manual: "followers" },
      actor,
      followers,
    ).canQuote;
    assert.deepStrictEqual(rule?.automaticApprovals, []);
    assert.deepStrictEqual(rule?.manualApprovals, [followers]);
  });
});

describe("parseQuotePolicy()", () => {
  const actor = new URL("https://example.com/ap/actor/bot");
  const followers = new URL("https://example.com/ap/actor/bot/followers");

  test("treats nullish approval lists as absent", () => {
    const rule = new InteractionRule({});
    Object.defineProperty(rule, "automaticApprovals", { value: null });
    Object.defineProperty(rule, "manualApprovals", { value: undefined });
    assert.deepStrictEqual(parseQuotePolicy(rule, actor, followers), {
      automatic: undefined,
      manual: undefined,
    });
  });
});
