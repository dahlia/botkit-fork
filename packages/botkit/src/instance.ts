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
import type {
  Federation,
  KvStore,
  MessageQueue,
} from "@fedify/fedify/federation";
import type { Software } from "@fedify/fedify/nodeinfo";
import type { Application, Image, Service } from "@fedify/vocab";
import type { Bot, PagesOptions } from "./bot.ts";
import type { CustomEmoji, DeferredCustomEmoji } from "./emoji.ts";
import { InstanceImpl } from "./instance-impl.ts";
export { INSTANCE_ACTOR_IDENTIFIER } from "./instance-impl.ts";
import type { Repository } from "./repository.ts";
import type { Text } from "./text.ts";

/**
 * The profile of a bot actor hosted on an {@link Instance}.  It configures
 * everything about a bot except its identifier and the shared infrastructure,
 * which belong to the instance.
 * @since 0.5.0
 */
export interface BotProfile<TContextData> {
  /**
   * The type of the bot actor.  It should be either `Service` or
   * `Application`.
   *
   * If omitted, `Service` will be used.
   * @default `Service`
   */
  readonly class?: typeof Service | typeof Application;

  /**
   * The username of the bot.  It will be a part of the fediverse handle.
   * It can be changed after the bot is federated.
   */
  readonly username: string;

  /**
   * The display name of the bot.  It can be changed after the bot is
   * federated.
   */
  readonly name?: string;

  /**
   * The description of the bot.  It can be changed after the bot is
   * federated.
   */
  readonly summary?: Text<"block", TContextData>;

  /**
   * The avatar URL of the bot.  It can be changed after the bot is federated.
   */
  readonly icon?: URL | Image;

  /**
   * The header image URL of the bot.  It can be changed after the bot is
   * federated.
   */
  readonly image?: URL | Image;

  /**
   * The custom properties of the bot.  It can be changed after the bot is
   * federated.
   */
  readonly properties?: Record<string, Text<"block" | "inline", TContextData>>;

  /**
   * How to handle incoming follow requests.  Note that this behavior can
   * be overridden by manually invoking {@link FollowRequest.accept} or
   * {@link FollowRequest.reject} in the {@link BotEventHandlers.onFollow}
   * event handler.
   *
   * - `"accept"` (default): Automatically accept all incoming follow
   *   requests.
   * - `"reject"`: Automatically reject all incoming follow requests.
   * - `"manual"`: Require manual handling of incoming follow requests.
   * @default `"accept"`
   */
  readonly followerPolicy?: "accept" | "reject" | "manual";
}

/**
 * A server instance that can host multiple bots.  An instance owns the
 * shared infrastructure—the key–value store, the message queue, the
 * repository, and HTTP handling—while each bot hosted on it has its own
 * actor identity and event handlers.
 * @since 0.5.0
 */
export interface Instance<TContextData> {
  /**
   * An internal Fedify federation instance.  Normally you don't need to
   * access this directly.
   */
  readonly federation: Federation<TContextData>;

  /**
   * Creates a bot with a fixed identifier and profile, hosted on this
   * instance.
   *
   * @example
   * ```typescript
   * const greetBot = instance.createBot("greet", {
   *   username: "greetbot",
   *   name: "Greeting Bot",
   * });
   *
   * greetBot.onFollow = async (session, followRequest) => {
   *   await followRequest.accept();
   * };
   * ```
   *
   * @param identifier The internal identifier for the bot.  Since it is used
   *                   for the actor URI, it *should not* be changed after
   *                   the bot is federated.
   * @param profile The profile of the bot.
   * @returns The created bot.
   * @throws {TypeError} If a bot with the same identifier or username
   *                     already exists on the instance.
   */
  createBot(
    identifier: string,
    profile: BotProfile<TContextData>,
  ): Bot<TContextData>;

  /**
   * The fetch API for handling HTTP requests.  You can pass this to an HTTP
   * server (e.g., `Deno.serve()`, `Bun.serve()`) to handle incoming
   * requests.
   * @param request The request to handle.
   * @param contextData The context data to pass to the federation.
   * @returns The response to the request.
   */
  fetch(request: Request, contextData: TContextData): Promise<Response>;

  /**
   * Defines custom emojis for the instance.  The custom emojis are shared by
   * all bots hosted on the instance and are used for rendering their
   * profiles and posts.
   * @param emojis The custom emojis to define.  The keys are the names of
   *               the emojis, and the values are the custom emoji
   *               definitions.
   * @returns The defined emojis.  The keys are the names of the emojis, and
   *          the values are the emoji objects, which are used for passing
   *          to the {@link customEmoji} function.
   * @throws {TypeError} If any emoji name is invalid or duplicate.
   */
  addCustomEmojis<TEmojiName extends string>(
    emojis: Readonly<Record<TEmojiName, CustomEmoji>>,
  ): Readonly<Record<TEmojiName, DeferredCustomEmoji<TContextData>>>;
}

/**
 * A specialized {@link Instance} type that doesn't require context data.
 * @since 0.5.0
 */
export interface InstanceWithVoidContextData extends Instance<void> {
  /**
   * The fetch API for handling HTTP requests.  You can pass this to an HTTP
   * server (e.g., `Deno.serve()`, `Bun.serve()`) to handle incoming
   * requests.
   * @param request The request to handle.
   * @returns The response to the request.
   */
  fetch(request: Request): Promise<Response>;
}

/**
 * Options for creating an {@link Instance}.
 * @since 0.5.0
 */
export interface CreateInstanceOptions {
  /**
   * The underlying key–value store to use for storing data.
   */
  readonly kv: KvStore;

  /**
   * The repository to use for storing bot data.  A single repository stores
   * the data of every bot hosted on the instance, scoped by their
   * identifiers.  If omitted, a {@link KvRepository} backed by `kv` will be
   * used.
   */
  readonly repository?: Repository;

  /**
   * The underlying message queue to use for handling incoming and outgoing
   * activities.  If omitted, incoming activities are processed immediately,
   * and outgoing activities are sent immediately.
   */
  readonly queue?: MessageQueue;

  /**
   * The software information of the instance.  If omitted, the NodeInfo
   * protocol will be unimplemented.
   */
  readonly software?: Software;

  /**
   * Whether to trust `X-Forwarded-*` headers.  If your instance is behind
   * an L7 reverse proxy, turn it on.
   *
   * Turned off by default.
   * @default `false`
   */
  readonly behindProxy?: boolean;

  /**
   * The options for the web pages of the instance.  If omitted, the default
   * options will be used.
   */
  readonly pages?: PagesOptions;

  /**
   * Configures the recognition of local object URIs in the legacy (pre-0.5)
   * format, which did not carry the owning bot actor identifier.  Set this
   * when the instance hosts a bot that was deployed with BotKit 0.4 or
   * earlier, so that object URIs stored by remote servers keep working.
   *
   * Legacy URIs can only occur in deployments that hosted a single bot
   * before the upgrade, so they are attributed to the configured bot.
   */
  readonly legacyObjectUris?: {
    /**
     * The identifier of the bot actor that owns objects with legacy URIs.
     */
    readonly identifier: string;
  };
}

/**
 * Creates an {@link Instance} that can host multiple bots sharing the same
 * infrastructure.
 *
 * @example
 * ```typescript
 * import { createInstance } from "@fedify/botkit";
 * import { MemoryKvStore } from "@fedify/fedify/federation";
 *
 * const instance = createInstance<void>({ kv: new MemoryKvStore() });
 * const greetBot = instance.createBot("greet", { username: "greetbot" });
 *
 * export default instance;
 * ```
 *
 * @param options The options for creating the instance.
 * @returns The created instance.
 * @since 0.5.0
 */
export function createInstance<TContextData = void>(
  options: CreateInstanceOptions,
): TContextData extends void ? InstanceWithVoidContextData
  : Instance<TContextData> {
  const instance = new InstanceImpl<TContextData>(options);
  // Since `deno serve` does not recognize a class instance having fetch(),
  // we wrap an InstanceImpl instance with a plain object.
  // See also https://github.com/denoland/deno/issues/24062
  const wrapper = {
    impl: instance,
    get federation(): Federation<TContextData> {
      return instance.federation;
    },
    createBot(
      identifier: string,
      profile: BotProfile<TContextData>,
    ): Bot<TContextData> {
      return instance.createBot(identifier, profile);
    },
    fetch(request: Request, contextData: TContextData): Promise<Response> {
      return instance.fetch(request, contextData);
    },
    addCustomEmojis<TEmojiName extends string>(
      emojis: Readonly<Record<TEmojiName, CustomEmoji>>,
    ): Readonly<Record<TEmojiName, DeferredCustomEmoji<TContextData>>> {
      return instance.addCustomEmojis(emojis);
    },
  } satisfies Instance<TContextData> & { impl: InstanceImpl<TContextData> };
  // @ts-ignore: the wrapper implements InstanceWithVoidContextData
  return wrapper;
}
