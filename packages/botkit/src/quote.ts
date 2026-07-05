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
import {
  type Actor,
  InteractionPolicy,
  InteractionRule,
  PUBLIC_COLLECTION,
  type QuoteRequest as RawQuoteRequest,
} from "@fedify/vocab";
import type { AuthorizedMessage, Message, MessageClass } from "./message.ts";

/**
 * The audience whose quote requests can be approved.
 * @since 0.5.0
 */
export type QuoteAcceptance = "public" | "followers" | "nobody";

/**
 * A quote policy for messages published by the bot.
 *
 * The `automatic` axis is accepted immediately.  The `manual` axis is exposed
 * to {@link QuoteRequestEventHandler} as a pending request.
 * @since 0.5.0
 */
export interface QuotePolicy {
  /**
   * The audience whose quote requests are accepted automatically.
   */
  readonly automatic?: QuoteAcceptance;

  /**
   * The audience whose quote requests wait for manual approval.
   */
  readonly manual?: QuoteAcceptance;
}

/**
 * A shorthand or full quote policy.
 * @since 0.5.0
 */
export type QuotePolicyOption = QuoteAcceptance | "manual" | QuotePolicy;

/**
 * A quote request to the bot.
 * @typeParam TContextData The type of the context data.
 * @since 0.5.0
 */
export interface QuoteRequest<TContextData> {
  /**
   * The URI of the quote request.
   */
  readonly id: URL;

  /**
   * The raw quote request object.
   */
  readonly raw: RawQuoteRequest;

  /**
   * The actor requesting quote authorization.
   */
  readonly actor: Actor;

  /**
   * The message that quotes the bot's message.
   */
  readonly quote: Message<MessageClass, TContextData>;

  /**
   * The bot's message being quoted.
   */
  readonly target: AuthorizedMessage<MessageClass, TContextData>;

  /**
   * The state of the quote request.
   */
  readonly state: "pending" | "accepted" | "rejected";

  /**
   * Accepts the quote request.
   * @throws {TypeError} The quote request is not pending.
   */
  accept(): Promise<void>;

  /**
   * Rejects the quote request.
   * @throws {TypeError} The quote request is not pending.
   */
  reject(): Promise<void>;
}

/**
 * Normalizes a quote policy option into the two-axis form.
 * @param policy The quote policy option to normalize.
 * @returns The normalized quote policy.
 * @since 0.5.0
 */
export function normalizeQuotePolicy(
  policy: QuotePolicyOption = "public",
): QuotePolicy {
  if (policy === "manual") return { manual: "public" };
  if (typeof policy === "string") return { automatic: policy };
  return policy;
}

export function serializeQuotePolicy(
  policy: QuotePolicyOption | undefined,
  actorUri: URL,
  followersUri: URL,
): InteractionPolicy {
  const normalized = normalizeQuotePolicy(policy);
  return new InteractionPolicy({
    canQuote: new InteractionRule({
      automaticApprovals: serializeQuoteAcceptance(
        normalized.automatic,
        actorUri,
        followersUri,
        true,
      ),
      manualApprovals: serializeQuoteAcceptance(
        normalized.manual,
        actorUri,
        followersUri,
        false,
      ),
    }),
  });
}

function serializeQuoteAcceptance(
  acceptance: QuoteAcceptance | undefined,
  actorUri: URL,
  followersUri: URL,
  automatic: boolean,
): URL[] {
  switch (acceptance) {
    case "public":
      return [PUBLIC_COLLECTION];
    case "followers":
      return automatic ? [actorUri, followersUri] : [followersUri];
    case "nobody":
      return automatic ? [actorUri] : [];
    default:
      return [];
  }
}
