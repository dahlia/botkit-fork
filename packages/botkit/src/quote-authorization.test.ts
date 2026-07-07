// BotKit by Fedify: A framework for creating ActivityPub bots
// Copyright (C) 2025-2026 Hong Minhee <https://hongminhee.org/>
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
import { QuoteAuthorization } from "@fedify/vocab";
import assert from "node:assert";
import { test } from "node:test";
import { validateQuoteAuthorization } from "./quote-authorization.ts";

const authorizationId = new URL("https://example.com/stamps/1");
const quoteId = new URL("https://quote.example/notes/1");
const targetId = new URL("https://example.com/notes/1");
const targetActorId = new URL("https://example.com/users/alice");

function createAuthorization(
  values: {
    readonly id?: URL;
    readonly attribution?: URL;
    readonly interactingObject?: URL;
    readonly interactionTarget?: URL;
  } = {},
): QuoteAuthorization {
  return new QuoteAuthorization({
    id: values.id ?? authorizationId,
    attribution: values.attribution ?? targetActorId,
    interactingObject: values.interactingObject ?? quoteId,
    interactionTarget: values.interactionTarget ?? targetId,
  });
}

test("validateQuoteAuthorization() accepts matching authorization", () => {
  assert.ok(
    validateQuoteAuthorization(createAuthorization(), {
      authorizationId,
      quoteId,
      targetId,
      targetActorId,
    }),
  );
});

test("validateQuoteAuthorization() rejects mismatched authorizations", () => {
  const cases: readonly [
    string,
    QuoteAuthorization,
    URL | undefined,
  ][] = [
    [
      "attributionId",
      createAuthorization({
        attribution: new URL("https://example.com/users/bob"),
      }),
      authorizationId,
    ],
    [
      "interactingObjectId",
      createAuthorization({
        interactingObject: new URL("https://quote.example/notes/2"),
      }),
      authorizationId,
    ],
    [
      "interactionTargetId",
      createAuthorization({
        interactionTarget: new URL("https://example.com/notes/2"),
      }),
      authorizationId,
    ],
    [
      "authorizationId",
      createAuthorization(),
      new URL("https://example.com/stamps/2"),
    ],
    [
      "origin",
      createAuthorization({
        id: new URL("https://malicious.example/stamps/1"),
      }),
      new URL("https://malicious.example/stamps/1"),
    ],
  ];

  for (const [name, authorization, expectedAuthorizationId] of cases) {
    assert.ok(
      !validateQuoteAuthorization(authorization, {
        authorizationId: expectedAuthorizationId,
        quoteId,
        targetId,
        targetActorId,
      }),
      name,
    );
  }
});

test("validateQuoteAuthorization() rejects non-authorization objects", () => {
  assert.ok(
    !validateQuoteAuthorization({}, {
      authorizationId,
      quoteId,
      targetId,
      targetActorId,
    }),
  );
});

test("validateQuoteAuthorization() rejects missing target actors", () => {
  assert.ok(
    !validateQuoteAuthorization(createAuthorization(), {
      authorizationId,
      quoteId,
      targetId,
      targetActorId: null,
    }),
  );
});
