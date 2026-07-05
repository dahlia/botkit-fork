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
  Accept,
  type Actor,
  QuoteAuthorization,
  type QuoteRequest as RawQuoteRequest,
  Reject,
} from "@fedify/vocab";
import { v7 as uuidv7 } from "uuid";
import type { AuthorizedMessage, Message, MessageClass } from "./message.ts";
import type { QuoteRequest } from "./quote.ts";
import type { Uuid } from "./repository.ts";
import type { SessionImpl } from "./session-impl.ts";

export class QuoteRequestImpl<TContextData>
  implements QuoteRequest<TContextData> {
  readonly session: SessionImpl<TContextData>;
  readonly id: URL;
  readonly raw: RawQuoteRequest;
  readonly actor: Actor;
  readonly quote: Message<MessageClass, TContextData>;
  readonly target: AuthorizedMessage<MessageClass, TContextData>;
  #state: "pending" | "accepted" | "rejected";

  get state(): "pending" | "accepted" | "rejected" {
    return this.#state;
  }

  constructor(
    session: SessionImpl<TContextData>,
    raw: RawQuoteRequest,
    actor: Actor,
    quote: Message<MessageClass, TContextData>,
    target: AuthorizedMessage<MessageClass, TContextData>,
  ) {
    if (raw.id == null) {
      throw new TypeError("The quote request ID is missing.");
    } else if (actor.id == null) {
      throw new TypeError("The quote requester ID is missing.");
    } else if (quote.id == null) {
      throw new TypeError("The quote message ID is missing.");
    }
    this.session = session;
    this.id = raw.id;
    this.raw = raw;
    this.actor = actor;
    this.quote = quote;
    this.target = target;
    this.#state = "pending";
  }

  async accept(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.#state !== "pending") {
      throw new TypeError("The quote request is not pending.");
    }
    const existing = await this.session.bot.repository.findQuoteAuthorization(
      this.quote.id,
    );
    signal?.throwIfAborted();
    const authorization = existing ?? await this.#createAuthorization();
    await this.session.context.sendActivity(
      this.session.bot,
      this.actor,
      new Accept({
        id: new URL(`/#accept/${this.id.href}`, this.session.actorId),
        actor: this.session.actorId,
        to: this.actor.id,
        object: this.raw,
        result: authorization.id,
      }),
      { excludeBaseUris: [new URL(this.session.context.origin)] },
    );
    this.#state = "accepted";
  }

  async reject(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.#state !== "pending") {
      throw new TypeError("The quote request is not pending.");
    }
    signal?.throwIfAborted();
    await this.session.context.sendActivity(
      this.session.bot,
      this.actor,
      new Reject({
        id: new URL(`/#reject/${this.id.href}`, this.session.actorId),
        actor: this.session.actorId,
        to: this.actor.id,
        object: this.raw,
      }),
      { excludeBaseUris: [new URL(this.session.context.origin)] },
    );
    this.#state = "rejected";
  }

  async #createAuthorization(): Promise<QuoteAuthorization> {
    const id = uuidv7() as Uuid;
    const authorization = new QuoteAuthorization({
      id: this.session.context.getObjectUri(QuoteAuthorization, {
        identifier: this.session.bot.identifier,
        id,
      }),
      attribution: this.session.actorId,
      interactingObject: this.quote.id,
      interactionTarget: this.target.id,
    });
    await this.session.bot.repository.addQuoteAuthorization(id, authorization);
    return await this.session.bot.repository.findQuoteAuthorization(
      this.quote.id,
    ) ?? authorization;
  }
}
