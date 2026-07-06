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

/**
 * Expected identifiers for validating a quote authorization stamp.
 *
 * @since 0.5.0
 */
export interface QuoteAuthorizationValidationOptions {
  /**
   * The expected quote authorization stamp ID.
   */
  readonly authorizationId?: URL;

  /**
   * The ID of the quote object that uses the authorization.
   */
  readonly quoteId: URL;

  /**
   * The ID of the quote target object.
   */
  readonly targetId: URL;

  /**
   * The actor that owns the quote target object.
   */
  readonly targetActorId: URL | null;
}

/**
 * Checks whether an object is a matching FEP-044f quote authorization stamp.
 *
 * @param authorization The fetched or stored object to validate.
 * @param options The identifiers the authorization must match.
 * @returns `true` if the object is a quote authorization for the quote.
 * @since 0.5.0
 */
export function validateQuoteAuthorization(
  authorization: unknown,
  options: QuoteAuthorizationValidationOptions,
): authorization is QuoteAuthorization {
  return authorization instanceof QuoteAuthorization &&
    authorization.id != null &&
    options.targetActorId != null &&
    (options.authorizationId == null ||
      authorization.id.href === options.authorizationId.href) &&
    authorization.id.origin === options.targetActorId.origin &&
    authorization.attributionId?.href === options.targetActorId.href &&
    authorization.interactingObjectId?.href === options.quoteId.href &&
    authorization.interactionTargetId?.href === options.targetId.href;
}
