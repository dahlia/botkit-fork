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
  type Context,
  createFederation,
  type Federation,
  generateCryptoKeyPair,
  type KvStore,
  type MessageQueue,
  type NodeInfo,
  type Software,
} from "@fedify/fedify";
import {
  Accept,
  type Activity,
  type Actor,
  Announce,
  Application,
  Article,
  ChatMessage,
  Create,
  Delete,
  Emoji as APEmoji,
  Endpoints,
  Follow,
  Image,
  Like as RawLike,
  Note,
  Question,
  Reject,
  Undo,
} from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import mimeDb from "mime-db";
import fs from "node:fs/promises";
import { getXForwardedRequest } from "x-forwarded-fetch";
import metadata from "../deno.json" with { type: "json" };
import { BotImpl } from "./bot-impl.ts";
import type { Bot, PagesOptions } from "./bot.ts";
import { wrapBotImpl } from "./bot-impl.ts";
import type { CustomEmoji, DeferredCustomEmoji } from "./emoji.ts";
import type {
  BotProfile,
  CreateInstanceOptions,
  Instance,
} from "./instance.ts";
import { app } from "./pages.tsx";
import { KvRepository, type Repository } from "./repository.ts";
import type { Session } from "./session.ts";
import { rewriteLegacyObjectPath } from "./uri.ts";

/**
 * The reserved identifier of the instance actor: an internal
 * `Application` actor that an {@link Instance} uses for signing
 * shared-inbox related requests on behalf of the whole instance.
 * Bots cannot take this identifier.
 * @since 0.5.0
 */
export const INSTANCE_ACTOR_IDENTIFIER = "_instance";

/**
 * Options for creating an {@link InstanceImpl}.
 * @internal
 */
export interface InstanceImplOptions extends CreateInstanceOptions {
  collectionWindow?: number;

  /**
   * Whether the instance was created through the single-bot
   * `createBot()` compatibility path.  A compatible instance keeps
   * the pre-0.5 behavior: the sole bot's key signs shared-inbox
   * requests and no instance actor is exposed.
   */
  compatMode?: boolean;
}

/**
 * The internal implementation of an {@link Instance}.  It owns the single
 * Fedify {@link Federation} shared by every bot hosted on the instance, and
 * routes federation callbacks to the right bot by its identifier.
 * @internal
 */
export class InstanceImpl<TContextData>
  implements Omit<Instance<TContextData>, "createBot"> {
  readonly kv: KvStore;
  readonly queue?: MessageQueue;

  /**
   * The root repository shared by every bot hosted on the instance.
   */
  readonly repository: Repository;
  readonly software?: Software;
  readonly behindProxy: boolean;
  readonly pages: Required<PagesOptions>;
  readonly collectionWindow: number;
  readonly federation: Federation<TContextData>;
  readonly customEmojis: Record<string, CustomEmoji> = {};

  /**
   * The identifier of the bot actor that owns local objects whose URIs are
   * in the legacy (pre-0.5) format, which did not carry the identifier.
   */
  readonly legacyObjectUrisIdentifier?: string;

  /**
   * Whether the instance was created through the single-bot
   * `createBot()` compatibility path.
   */
  readonly compatMode: boolean;

  readonly #bots: Map<string, BotImpl<TContextData>> = new Map();

  constructor(options: InstanceImplOptions) {
    this.kv = options.kv;
    this.queue = options.queue;
    this.repository = options.repository ?? new KvRepository(options.kv);
    this.software = options.software;
    this.behindProxy = options.behindProxy ?? false;
    this.pages = {
      color: "green",
      css: "",
      ...(options.pages ?? {}),
    };
    this.collectionWindow = options.collectionWindow ?? 50;
    this.legacyObjectUrisIdentifier = options.legacyObjectUris?.identifier;
    this.compatMode = options.compatMode ?? false;
    this.federation = createFederation<TContextData>({
      kv: options.kv,
      queue: options.queue,
      userAgent: {
        software: `BotKit/${metadata.version}`,
      },
    });
    this.#initialize();
  }

  #initialize(): void {
    this.federation
      .setActorDispatcher(
        "/ap/actor/{identifier}",
        (ctx, identifier) => {
          if (!this.compatMode && identifier === INSTANCE_ACTOR_IDENTIFIER) {
            return this.#dispatchInstanceActor(ctx);
          }
          return this.getBot(identifier)?.dispatchActor(ctx, identifier) ??
            null;
        },
      )
      .mapHandle((ctx, username) => this.mapHandle(ctx, username))
      .setKeyPairsDispatcher((ctx, identifier) => {
        if (!this.compatMode && identifier === INSTANCE_ACTOR_IDENTIFIER) {
          return this.#dispatchInstanceActorKeyPairs();
        }
        return this.getBot(identifier)
          ?.dispatchActorKeyPairs(ctx, identifier) ?? [];
      });
    this.federation
      .setFollowersDispatcher(
        "/ap/actor/{identifier}/followers",
        (ctx, identifier, cursor) =>
          this.getBot(identifier)
            ?.dispatchFollowers(ctx, identifier, cursor) ?? null,
      )
      .setFirstCursor((ctx, identifier) =>
        this.getBot(identifier)?.getFollowersFirstCursor(ctx, identifier) ??
          null
      )
      .setCounter((ctx, identifier) =>
        this.getBot(identifier)?.countFollowers(ctx, identifier) ?? null
      );
    this.federation
      .setOutboxDispatcher(
        "/ap/actor/{identifier}/outbox",
        (ctx, identifier, cursor) =>
          this.getBot(identifier)?.dispatchOutbox(ctx, identifier, cursor) ??
            null,
      )
      .setFirstCursor((ctx, identifier) =>
        this.getBot(identifier)?.getOutboxFirstCursor(ctx, identifier) ?? null
      )
      .setCounter((ctx, identifier) =>
        this.getBot(identifier)?.countOutbox(ctx, identifier) ?? null
      );
    this.federation
      .setObjectDispatcher(
        Follow,
        "/ap/actor/{identifier}/follow/{id}",
        (ctx, values) =>
          this.getBot(values.identifier)?.dispatchFollow(ctx, values) ?? null,
      )
      .authorize((ctx, values) =>
        this.getBot(values.identifier)?.authorizeFollow(ctx, values) ?? false
      );
    this.federation.setObjectDispatcher(
      Create,
      "/ap/actor/{identifier}/create/{id}",
      (ctx, values) =>
        this.getBot(values.identifier)?.dispatchCreate(ctx, values) ?? null,
    );
    this.federation.setObjectDispatcher(
      Article,
      "/ap/actor/{identifier}/article/{id}",
      (ctx, values) =>
        this.getBot(values.identifier)
          ?.dispatchMessage(Article, ctx, values.id) ?? null,
    );
    this.federation.setObjectDispatcher(
      ChatMessage,
      "/ap/actor/{identifier}/chat-message/{id}",
      (ctx, values) =>
        this.getBot(values.identifier)
          ?.dispatchMessage(ChatMessage, ctx, values.id) ?? null,
    );
    this.federation.setObjectDispatcher(
      Note,
      "/ap/actor/{identifier}/note/{id}",
      (ctx, values) =>
        this.getBot(values.identifier)
          ?.dispatchMessage(Note, ctx, values.id) ?? null,
    );
    this.federation.setObjectDispatcher(
      Question,
      "/ap/actor/{identifier}/question/{id}",
      (ctx, values) =>
        this.getBot(values.identifier)
          ?.dispatchMessage(Question, ctx, values.id) ?? null,
    );
    this.federation.setObjectDispatcher(
      Announce,
      "/ap/actor/{identifier}/announce/{id}",
      (ctx, values) =>
        this.getBot(values.identifier)?.dispatchAnnounce(ctx, values) ?? null,
    );
    this.federation.setObjectDispatcher(
      APEmoji,
      "/ap/emoji/{name}",
      (ctx, values) => this.dispatchEmoji(ctx, values),
    );
    this.federation
      .setInboxListeners("/ap/actor/{identifier}/inbox", "/ap/inbox")
      .onUnverifiedActivity((ctx, activity, reason) =>
        this.onUnverifiedActivity(ctx, activity, reason)
      )
      .on(Follow, async (ctx, follow) => {
        for (const bot of this.#bots.values()) {
          await bot.onFollowed(ctx, follow);
        }
      })
      .on(Undo, async (ctx, undo) => {
        const object = await undo.getObject(ctx);
        if (object instanceof Follow) {
          for (const bot of this.#bots.values()) {
            await bot.onUnfollowed(ctx, undo);
          }
        } else if (object instanceof RawLike) {
          for (const bot of this.#bots.values()) {
            await bot.onUnliked(ctx, undo);
          }
        } else {
          const logger = getLogger(["botkit", "bot", "inbox"]);
          logger.warn(
            "The Undo object {undoId} is not about Follow or Like: {object}.",
            { undoId: undo.id?.href, object },
          );
        }
      })
      .on(Accept, async (ctx, accept) => {
        for (const bot of this.#bots.values()) {
          await bot.onFollowAccepted(ctx, accept);
        }
      })
      .on(Reject, async (ctx, reject) => {
        for (const bot of this.#bots.values()) {
          await bot.onFollowRejected(ctx, reject);
        }
      })
      .on(Create, async (ctx, create) => {
        for (const bot of this.#bots.values()) {
          await bot.onCreated(ctx, create);
        }
      })
      .on(Announce, async (ctx, announce) => {
        for (const bot of this.#bots.values()) {
          await bot.onAnnounced(ctx, announce);
        }
      })
      .on(RawLike, async (ctx, like) => {
        for (const bot of this.#bots.values()) {
          await bot.onLiked(ctx, like);
        }
      })
      .setSharedKeyDispatcher((ctx) => this.dispatchSharedKey(ctx));
    if (this.software != null) {
      this.federation.setNodeInfoDispatcher(
        "/nodeinfo/2.1",
        (ctx) => this.dispatchNodeInfo(ctx),
      );
    }
  }

  /**
   * Registers a bot on the instance.  Invoked by the {@link BotImpl}
   * constructor.
   * @param bot The bot to register.
   * @throws {TypeError} If a bot with the same identifier or username
   *                     already exists on the instance.
   */
  addBot(bot: BotImpl<TContextData>): void {
    if (!this.compatMode && bot.identifier === INSTANCE_ACTOR_IDENTIFIER) {
      throw new TypeError(
        `The identifier is reserved for the instance actor: ${bot.identifier}`,
      );
    }
    if (this.#bots.has(bot.identifier)) {
      throw new TypeError(
        `A bot with the identifier already exists: ${bot.identifier}`,
      );
    }
    for (const existing of this.#bots.values()) {
      if (existing.username === bot.username) {
        throw new TypeError(
          `A bot with the username already exists: ${bot.username}`,
        );
      }
    }
    this.#bots.set(bot.identifier, bot);
  }

  /**
   * Resolves a bot hosted on the instance by its identifier.
   * @param identifier The identifier of the bot to resolve.
   * @returns The resolved bot, or `undefined` if no bot has the identifier.
   */
  getBot(identifier: string): BotImpl<TContextData> | undefined {
    return this.#bots.get(identifier);
  }

  /**
   * Every bot hosted on the instance.
   */
  get bots(): Iterable<BotImpl<TContextData>> {
    return this.#bots.values();
  }

  /**
   * The number of bots hosted on the instance.
   */
  get botCount(): number {
    return this.#bots.size;
  }

  #firstBot(): BotImpl<TContextData> | undefined {
    return this.#bots.values().next().value;
  }

  createBot(
    identifier: string,
    profile: BotProfile<TContextData>,
  ): Bot<TContextData> {
    const bot = new BotImpl<TContextData>({
      instance: this,
      identifier,
      kv: this.kv,
      class: profile.class,
      username: profile.username,
      name: profile.name,
      summary: profile.summary,
      icon: profile.icon,
      image: profile.image,
      properties: profile.properties,
      followerPolicy: profile.followerPolicy,
    });
    return wrapBotImpl(bot);
  }

  mapHandle(
    _ctx: Context<TContextData>,
    username: string,
  ): string | null {
    for (const bot of this.#bots.values()) {
      if (bot.username === username) return bot.identifier;
    }
    return null;
  }

  onUnverifiedActivity(
    _ctx: Context<TContextData>,
    activity: Activity,
    reason: { type: string; result?: unknown },
  ): Response | void {
    if (
      activity instanceof Delete &&
      reason.type === "keyFetchError" &&
      typeof reason.result === "object" && reason.result != null &&
      "status" in reason.result &&
      reason.result.status === 410
    ) {
      return new Response(null, { status: 202 });
    }
  }

  dispatchSharedKey(_ctx: Context<TContextData>): { identifier: string } {
    if (this.compatMode) {
      const bot = this.#firstBot();
      if (bot == null) {
        throw new TypeError(
          "The instance has no bots; the shared inbox key cannot be " +
            "dispatched.",
        );
      }
      return { identifier: bot.identifier };
    }
    return { identifier: INSTANCE_ACTOR_IDENTIFIER };
  }

  async #dispatchInstanceActor(
    ctx: Context<TContextData>,
  ): Promise<Actor> {
    const keyPairs = await ctx.getActorKeyPairs(INSTANCE_ACTOR_IDENTIFIER);
    return new Application({
      id: ctx.getActorUri(INSTANCE_ACTOR_IDENTIFIER),
      preferredUsername: INSTANCE_ACTOR_IDENTIFIER,
      name: "Instance actor",
      summary: "An internal actor the instance uses for signing requests " +
        "on behalf of the whole instance.",
      inbox: ctx.getInboxUri(INSTANCE_ACTOR_IDENTIFIER),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      publicKey: keyPairs[0].cryptographicKey,
      assertionMethods: keyPairs.map((pair) => pair.multikey),
      discoverable: false,
    });
  }

  async #dispatchInstanceActorKeyPairs(): Promise<CryptoKeyPair[]> {
    let keyPairs = await this.repository.getKeyPairs(
      INSTANCE_ACTOR_IDENTIFIER,
    );
    if (keyPairs == null) {
      const rsa = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
      const ed25519 = await generateCryptoKeyPair("Ed25519");
      keyPairs = [rsa, ed25519];
      await this.repository.setKeyPairs(INSTANCE_ACTOR_IDENTIFIER, keyPairs);
    }
    return keyPairs;
  }

  dispatchNodeInfo(_ctx: Context<TContextData>): NodeInfo {
    return {
      software: this.software!,
      protocols: ["activitypub"],
      services: {
        outbound: ["atom1.0"], // TODO
      },
      usage: {
        users: {
          total: this.botCount,
          activeMonth: this.botCount, // FIXME
          activeHalfyear: this.botCount, // FIXME
        },
        localPosts: 0, // FIXME
        localComments: 0,
      },
    };
  }

  dispatchEmoji(
    ctx: Context<TContextData>,
    values: { name: string },
  ): APEmoji | null {
    const customEmoji = this.customEmojis[values.name];
    if (customEmoji == null) return null;
    return this.getEmoji(ctx, values.name, customEmoji);
  }

  getEmoji(
    ctx: Context<TContextData>,
    name: string,
    data: CustomEmoji,
  ): APEmoji {
    let url: URL;
    if ("url" in data) {
      url = new URL(data.url);
    } else {
      // @ts-ignore: data.type satisfies keyof typeof mimeDb
      const t = mimeDb[data.type];
      url = new URL(
        `/emojis/${name}${
          t == null || t.extensions == null || t.extensions.length < 1
            ? ""
            : `.${t.extensions[0]}`
        }`,
        ctx.origin,
      );
    }
    return new APEmoji({
      id: ctx.getObjectUri(APEmoji, { name }),
      name: `:${name}:`,
      icon: new Image({
        mediaType: data.type,
        url,
      }),
    });
  }

  addCustomEmoji<TEmojiName extends string>(
    name: TEmojiName,
    data: CustomEmoji,
  ): DeferredCustomEmoji<TContextData> {
    if (!name.match(/^[a-z0-9-_]+$/i)) {
      throw new TypeError(
        `Invalid custom emoji name: ${name}. It must match /^[a-z0-9-_]+$/i.`,
      );
    } else if (name in this.customEmojis) {
      throw new TypeError(`Duplicate custom emoji name: ${name}`);
    } else if (!data.type.startsWith("image/")) {
      throw new TypeError(`Unsupported media type: ${data.type}`);
    }
    this.customEmojis[name] = data;
    return (session: Session<TContextData>) =>
      this.getEmoji(
        session.context,
        name,
        data,
      );
  }

  addCustomEmojis<TEmojiName extends string>(
    emojis: Readonly<Record<TEmojiName, CustomEmoji>>,
  ): Readonly<Record<TEmojiName, DeferredCustomEmoji<TContextData>>> {
    const emojiMap = {} as Record<
      TEmojiName,
      DeferredCustomEmoji<TContextData>
    >;
    for (const name in emojis) {
      emojiMap[name] = this.addCustomEmoji(name, emojis[name]);
    }
    return emojiMap;
  }

  async addCollectionInverseProperty(
    request: Request,
    contextData: TContextData,
    response: Response,
  ): Promise<Response> {
    if (!response.ok) return response;
    const ctx = this.federation.createContext(request, contextData);
    const parsed = ctx.parseUri(new URL(request.url));
    if (
      parsed == null ||
      (parsed.type !== "outbox" && parsed.type !== "followers") ||
      parsed.identifier == null
    ) {
      return response;
    }
    const contentType = response.headers.get("Content-Type");
    if (
      contentType == null ||
      (
        !contentType.startsWith("application/activity+json") &&
        !contentType.startsWith("application/ld+json")
      )
    ) {
      return response;
    }
    const body = await response.json();
    if (typeof body !== "object" || body == null || Array.isArray(body)) {
      return new Response(JSON.stringify(body), {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    }
    const property = parsed.type === "outbox" ? "outboxOf" : "followersOf";
    const actorUri = ctx.getActorUri(parsed.identifier).href;
    if (body[property] === actorUri) {
      return new Response(JSON.stringify(body), {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    }
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    return new Response(JSON.stringify({ ...body, [property]: actorUri }), {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  async fetch(request: Request, contextData: TContextData): Promise<Response> {
    if (this.behindProxy) {
      request = await getXForwardedRequest(request);
    }
    const url = new URL(request.url);
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      this.legacyObjectUrisIdentifier != null
    ) {
      // Dereferenceable requests to object URIs in the legacy (pre-0.5)
      // format are permanently redirected to their canonical URIs:
      const rewrittenPath = rewriteLegacyObjectPath(
        url.pathname,
        this.legacyObjectUrisIdentifier,
      );
      if (rewrittenPath != null) {
        const location = new URL(url.href);
        location.pathname = rewrittenPath;
        return new Response(null, {
          status: 301,
          headers: { Location: location.href },
        });
      }
    }
    if (
      url.pathname.startsWith("/.well-known/") ||
      url.pathname.startsWith("/ap/") ||
      url.pathname.startsWith("/nodeinfo/")
    ) {
      const response = await this.federation.fetch(request, { contextData });
      return await this.addCollectionInverseProperty(
        request,
        contextData,
        response,
      );
    }
    const match = /^\/emojis\/([a-z0-9-_]+)(?:$|\.)/.exec(url.pathname);
    if (match != null) {
      const customEmoji = this.customEmojis[match[1]];
      if (customEmoji == null || !("file" in customEmoji)) {
        return new Response("Not Found", { status: 404 });
      }
      let file: fs.FileHandle;
      try {
        file = await fs.open(customEmoji.file, "r");
      } catch (error) {
        if (
          typeof error === "object" && error != null && "code" in error &&
          error.code === "ENOENT"
        ) {
          return new Response("Not Found", { status: 404 });
        }
        throw error;
      }
      const fileInfo = await file.stat();
      return new Response(file.readableWebStream(), {
        headers: {
          "Content-Type": customEmoji.type,
          "Content-Length": fileInfo.size.toString(),
          "Cache-Control": "public, max-age=31536000, immutable",
          "Last-Modified": (fileInfo.mtime ?? new Date()).toUTCString(),
          "ETag": `"${fileInfo.mtime?.getTime().toString(36)}${
            fileInfo.size.toString(36)
          }"`,
        },
      });
    }
    const bot = this.#firstBot();
    if (bot == null) return new Response("Not Found", { status: 404 });
    return await app.fetch(request, { bot, contextData });
  }
}
