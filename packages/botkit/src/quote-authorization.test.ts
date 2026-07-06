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

test("validateQuoteAuthorization() rejects missing target actors", () => {
  const authorization = new QuoteAuthorization({
    id: new URL("https://example.com/stamps/1"),
    attribution: new URL("https://example.com/users/alice"),
    interactingObject: new URL("https://quote.example/notes/1"),
    interactionTarget: new URL("https://example.com/notes/1"),
  });

  assert.ok(
    !validateQuoteAuthorization(authorization, {
      authorizationId: authorization.id!,
      quoteId: new URL("https://quote.example/notes/1"),
      targetId: new URL("https://example.com/notes/1"),
      targetActorId: null,
    }),
  );
});
