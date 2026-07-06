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
import { QuoteAuthorization } from "@fedify/vocab";

export interface QuoteAuthorizationValidationOptions {
  readonly authorizationId?: URL;
  readonly quoteId: URL;
  readonly targetId: URL;
  readonly targetActorId: URL;
}

export function validateQuoteAuthorization(
  authorization: unknown,
  options: QuoteAuthorizationValidationOptions,
): authorization is QuoteAuthorization {
  return authorization instanceof QuoteAuthorization &&
    authorization.id != null &&
    (options.authorizationId == null ||
      authorization.id.href === options.authorizationId.href) &&
    authorization.id.origin === options.targetActorId.origin &&
    authorization.attributionId?.href === options.targetActorId.href &&
    authorization.interactingObjectId?.href === options.quoteId.href &&
    authorization.interactionTargetId?.href === options.targetId.href;
}
