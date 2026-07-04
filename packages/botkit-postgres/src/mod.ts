// BotKit by Fedify: A framework for creating ActivityPub bots
// Copyright (C) 2026 Hong Minhee <https://hongminhee.org/>
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
  ActorScopedRepository,
  type Repository,
  type RepositoryGetFollowersOptions,
  type RepositoryGetMessagesOptions,
  type Uuid,
} from "@fedify/botkit/repository";
import { exportJwk, importJwk } from "@fedify/fedify/sig";
import { Temporal, toTemporalInstant } from "@js-temporal/polyfill";
import {
  Activity,
  type Actor,
  Announce,
  Create,
  Follow,
  isActor,
  Object,
} from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import postgres from "postgres";

if (!("Temporal" in globalThis)) {
  Reflect.set(globalThis, "Temporal", Temporal);
}
if (Date.prototype.toTemporalInstant == null) {
  Reflect.set(Date.prototype, "toTemporalInstant", toTemporalInstant);
}

const logger = getLogger(["botkit", "postgres"]);
const schemaNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const followRequestAdvisoryLockNamespace = 0x4254;
const followerAdvisoryLockNamespace = 0x4246;

type Queryable = Pick<postgres.Sql, "unsafe">;
type QueryParameter = postgres.SerializableParameter;

/**
 * Common options for creating a PostgreSQL repository.
 * @since 0.4.0
 */
interface PostgresRepositoryOptionsBase {
  /**
   * The PostgreSQL schema name to use.
   * @default `"botkit"`
   */
  readonly schema?: string;

  /**
   * Whether to use prepared statements for queries.
   * @default true
   */
  readonly prepare?: boolean;
}

/**
 * Options for creating a PostgreSQL repository from an injected client.
 * @since 0.4.0
 */
interface PostgresRepositoryOptionsWithClient
  extends PostgresRepositoryOptionsBase {
  /**
   * A pre-configured PostgreSQL client to use.
   */
  readonly sql: postgres.Sql;

  /**
   * Disallowed when `sql` is provided.
   */
  readonly url?: never;

  /**
   * Disallowed when `sql` is provided.
   */
  readonly maxConnections?: never;
}

/**
 * Options for creating a PostgreSQL repository from a connection string.
 * @since 0.4.0
 */
interface PostgresRepositoryOptionsWithUrl
  extends PostgresRepositoryOptionsBase {
  /**
   * A PostgreSQL connection string to connect with.
   */
  readonly url: string | URL;

  /**
   * Disallowed when `url` is provided.
   */
  readonly sql?: never;

  /**
   * The maximum number of connections for an owned pool.
   */
  readonly maxConnections?: number;
}

/**
 * Options for creating a PostgreSQL repository.
 * @since 0.4.0
 */
export type PostgresRepositoryOptions =
  | PostgresRepositoryOptionsWithClient
  | PostgresRepositoryOptionsWithUrl;

/**
 * Initializes the PostgreSQL schema used by BotKit repositories.
 * @param sql The PostgreSQL client to initialize the schema with.
 * @param schema The PostgreSQL schema name to initialize.
 * @param prepare Whether to use prepared statements for schema queries.
 * @since 0.4.0
 */
export async function initializePostgresRepositorySchema(
  sql: Queryable,
  schema = "botkit",
  prepare = true,
): Promise<void> {
  const validatedSchema = validateSchemaName(schema);
  await execute(
    sql,
    `CREATE SCHEMA IF NOT EXISTS "${validatedSchema}"`,
    [],
    prepare,
  );
  await execute(
    sql,
    `CREATE TABLE IF NOT EXISTS "${validatedSchema}"."key_pairs" (
       bot_id TEXT NOT NULL,
       position INTEGER NOT NULL,
       private_key_jwk JSONB NOT NULL,
       public_key_jwk JSONB NOT NULL,
       PRIMARY KEY (bot_id, position)
     )`,
    [],
    prepare,
  );
  await execute(
    sql,
    `CREATE TABLE IF NOT EXISTS "${validatedSchema}"."messages" (
       bot_id TEXT NOT NULL,
       id TEXT NOT NULL,
       activity_json JSONB NOT NULL,
       published BIGINT,
       PRIMARY KEY (bot_id, id)
     )`,
    [],
    prepare,
  );
  await execute(
    sql,
    `CREATE INDEX IF NOT EXISTS "idx_messages_published"
       ON "${validatedSchema}"."messages" (bot_id, published, id)`,
    [],
    prepare,
  );
  await execute(
    sql,
    `CREATE TABLE IF NOT EXISTS "${validatedSchema}"."followers" (
       bot_id TEXT NOT NULL,
       follower_id TEXT NOT NULL,
       actor_json JSONB NOT NULL,
       PRIMARY KEY (bot_id, follower_id)
     )`,
    [],
    prepare,
  );
  await execute(
    sql,
    `CREATE TABLE IF NOT EXISTS "${validatedSchema}"."follow_requests" (
       bot_id TEXT NOT NULL,
       follow_request_id TEXT NOT NULL,
       follower_id TEXT NOT NULL,
       PRIMARY KEY (bot_id, follow_request_id),
       FOREIGN KEY (bot_id, follower_id)
         REFERENCES "${validatedSchema}"."followers" (bot_id, follower_id)
         ON DELETE CASCADE
     )`,
    [],
    prepare,
  );
  await execute(
    sql,
    `CREATE INDEX IF NOT EXISTS "idx_follow_requests_follower"
       ON "${validatedSchema}"."follow_requests" (bot_id, follower_id)`,
    [],
    prepare,
  );
  await execute(
    sql,
    `CREATE TABLE IF NOT EXISTS "${validatedSchema}"."sent_follows" (
       bot_id TEXT NOT NULL,
       id TEXT NOT NULL,
       follow_json JSONB NOT NULL,
       PRIMARY KEY (bot_id, id)
     )`,
    [],
    prepare,
  );
  await execute(
    sql,
    `CREATE TABLE IF NOT EXISTS "${validatedSchema}"."followees" (
       bot_id TEXT NOT NULL,
       followee_id TEXT NOT NULL,
       follow_json JSONB NOT NULL,
       PRIMARY KEY (bot_id, followee_id)
     )`,
    [],
    prepare,
  );
  await execute(
    sql,
    `CREATE INDEX IF NOT EXISTS "idx_followees_followee_id"
       ON "${validatedSchema}"."followees" (followee_id)`,
    [],
    prepare,
  );
  await execute(
    sql,
    `CREATE TABLE IF NOT EXISTS "${validatedSchema}"."poll_votes" (
       bot_id TEXT NOT NULL,
       message_id TEXT NOT NULL,
       voter_id TEXT NOT NULL,
       option TEXT NOT NULL,
       PRIMARY KEY (bot_id, message_id, voter_id, option)
     )`,
    [],
    prepare,
  );
  await execute(
    sql,
    `CREATE INDEX IF NOT EXISTS "idx_poll_votes_message_option"
       ON "${validatedSchema}"."poll_votes" (bot_id, message_id, option)`,
    [],
    prepare,
  );
}

/**
 * A repository for storing bot data using PostgreSQL.
 * @since 0.4.0
 */
export class PostgresRepository implements Repository, AsyncDisposable {
  readonly sql: postgres.Sql;
  readonly schema: string;
  readonly prepare: boolean;
  private readonly ownsSql: boolean;
  private readonly ready: Promise<void>;

  constructor(options: PostgresRepositoryOptions) {
    this.schema = validateSchemaName(options.schema ?? "botkit");
    this.prepare = options.prepare ?? true;
    if ("sql" in options) {
      if (options.url != null || options.maxConnections != null) {
        throw new TypeError(
          "PostgresRepositoryOptions.sql cannot be combined with PostgresRepositoryOptions.url or PostgresRepositoryOptions.maxConnections.",
        );
      }
      this.ownsSql = false;
      this.sql = options.sql;
    } else {
      if (options.url == null) {
        throw new TypeError(
          "PostgresRepositoryOptions.url must be provided when PostgresRepositoryOptions.sql is absent.",
        );
      }
      this.ownsSql = true;
      const url = typeof options.url === "string"
        ? options.url
        : options.url.href;
      this.sql = postgres(url, {
        max: options.maxConnections,
        onnotice: () => {},
        prepare: this.prepare,
      });
    }
    const ready = initializePostgresRepositorySchema(
      this.sql,
      this.schema,
      this.prepare,
    );
    // Avoid unhandled rejection warnings before a repository method awaits it.
    ready.catch(() => {});
    this.ready = ready;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /**
   * Closes the underlying PostgreSQL connection pool if owned by the
   * repository.
   */
  async close(): Promise<void> {
    try {
      await this.ready;
    } finally {
      if (this.ownsSql) {
        await this.sql.end({ timeout: 5 });
      }
    }
  }

  async setKeyPairs(
    identifier: string,
    keyPairs: CryptoKeyPair[],
  ): Promise<void> {
    await this.ensureReady();
    await this.sql.begin(async (sql) => {
      await this.query(
        sql,
        `DELETE FROM ${this.table("key_pairs")} WHERE bot_id = $1`,
        [identifier],
      );
      for (const [position, keyPair] of keyPairs.entries()) {
        const privateJwk = await exportJwk(keyPair.privateKey);
        const publicJwk = await exportJwk(keyPair.publicKey);
        await this.query(
          sql,
          `INSERT INTO ${this.table("key_pairs")}
             (bot_id, position, private_key_jwk, public_key_jwk)
           VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
          [
            identifier,
            position,
            serializeJson(privateJwk),
            serializeJson(publicJwk),
          ],
        );
      }
    });
  }

  async getKeyPairs(identifier: string): Promise<CryptoKeyPair[] | undefined> {
    await this.ensureReady();
    const rows = await this.query<{
      readonly private_key_jwk: unknown;
      readonly public_key_jwk: unknown;
    }>(
      this.sql,
      `SELECT private_key_jwk, public_key_jwk
         FROM ${this.table("key_pairs")}
        WHERE bot_id = $1
     ORDER BY position ASC`,
      [identifier],
    );
    if (rows.length < 1) return undefined;
    const keyPairs: CryptoKeyPair[] = [];
    for (const row of rows) {
      const privateJwk = normalizeJsonObject(row.private_key_jwk);
      const publicJwk = normalizeJsonObject(row.public_key_jwk);
      if (privateJwk == null || publicJwk == null) {
        throw new TypeError("A stored key pair is malformed.");
      }
      keyPairs.push({
        privateKey: await importJwk(privateJwk, "private"),
        publicKey: await importJwk(publicJwk, "public"),
      });
    }
    return keyPairs;
  }

  async addMessage(
    identifier: string,
    id: Uuid,
    activity: Create | Announce,
  ): Promise<void> {
    await this.ensureReady();
    await this.query(
      this.sql,
      `INSERT INTO ${this.table("messages")}
         (bot_id, id, activity_json, published)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [
        identifier,
        id,
        serializeJson(await activity.toJsonLd({ format: "compact" })),
        activity.published?.epochMilliseconds ?? null,
      ],
    );
  }

  async updateMessage(
    identifier: string,
    id: Uuid,
    updater: (
      existing: Create | Announce,
    ) => Create | Announce | undefined | Promise<Create | Announce | undefined>,
  ): Promise<boolean> {
    await this.ensureReady();
    return await this.sql.begin(async (sql) => {
      const rows = await this.query<{ readonly activity_json: unknown }>(
        sql,
        `SELECT activity_json
           FROM ${this.table("messages")}
          WHERE bot_id = $1 AND id = $2
          FOR UPDATE`,
        [identifier, id],
      );
      const row = rows[0];
      if (row == null) return false;
      const activity = await parseActivity(row.activity_json);
      if (activity == null) return false;
      const updated = await updater(activity);
      if (updated == null) return false;
      await this.query(
        sql,
        `UPDATE ${this.table("messages")}
            SET activity_json = $1::jsonb,
                published = $2
          WHERE bot_id = $3 AND id = $4`,
        [
          serializeJson(await updated.toJsonLd({ format: "compact" })),
          updated.published?.epochMilliseconds ?? null,
          identifier,
          id,
        ],
      );
      return true;
    });
  }

  async removeMessage(
    identifier: string,
    id: Uuid,
  ): Promise<Create | Announce | undefined> {
    await this.ensureReady();
    const rows = await this.query<{ readonly activity_json: unknown }>(
      this.sql,
      `DELETE FROM ${this.table("messages")}
        WHERE bot_id = $1 AND id = $2
    RETURNING activity_json`,
      [identifier, id],
    );
    return await parseActivity(rows[0]?.activity_json);
  }

  async *getMessages(
    identifier: string,
    options: RepositoryGetMessagesOptions = {},
  ): AsyncIterable<Create | Announce> {
    await this.ensureReady();
    const { order = "newest", since, until, limit } = options;
    const parameters: QueryParameter[] = [identifier];
    let query = `SELECT activity_json
                   FROM ${this.table("messages")}
                  WHERE bot_id = $1`;
    if (since != null) {
      parameters.push(since.epochMilliseconds);
      query += ` AND published >= $${parameters.length}`;
    }
    if (until != null) {
      parameters.push(until.epochMilliseconds);
      query += ` AND published <= $${parameters.length}`;
    }
    query += order === "oldest"
      ? " ORDER BY published ASC NULLS LAST, id ASC"
      : " ORDER BY published DESC NULLS LAST, id DESC";
    if (limit != null) {
      parameters.push(limit);
      query += ` LIMIT $${parameters.length}`;
    }
    const rows = await this.query<{ readonly activity_json: unknown }>(
      this.sql,
      query,
      parameters,
    );
    for (const row of rows) {
      const activity = await parseActivity(row.activity_json);
      if (activity != null) yield activity;
    }
  }

  async getMessage(
    identifier: string,
    id: Uuid,
  ): Promise<Create | Announce | undefined> {
    await this.ensureReady();
    const rows = await this.query<{ readonly activity_json: unknown }>(
      this.sql,
      `SELECT activity_json
         FROM ${this.table("messages")}
        WHERE bot_id = $1 AND id = $2`,
      [identifier, id],
    );
    return await parseActivity(rows[0]?.activity_json);
  }

  async countMessages(identifier: string): Promise<number> {
    await this.ensureReady();
    const rows = await this.query<{ readonly count: number }>(
      this.sql,
      `SELECT COUNT(*)::integer AS count
         FROM ${this.table("messages")}
        WHERE bot_id = $1`,
      [identifier],
    );
    return rows[0]?.count ?? 0;
  }

  async addFollower(
    identifier: string,
    followId: URL,
    follower: Actor,
  ): Promise<void> {
    await this.ensureReady();
    if (follower.id == null) {
      throw new TypeError("The follower ID is missing.");
    }
    const followerId = follower.id;
    const followerJson = await follower.toJsonLd({ format: "compact" });
    await this.sql.begin(async (sql) => {
      await this.lockFollowRequest(sql, identifier, followId);
      const rows = await this.query<{ readonly follower_id: string }>(
        sql,
        `SELECT follower_id
           FROM ${this.table("follow_requests")}
          WHERE bot_id = $1 AND follow_request_id = $2
          FOR UPDATE`,
        [identifier, followId.href],
      );
      const previousFollowerId = rows[0]?.follower_id;
      await this.lockFollowers(sql, identifier, [
        followerId.href,
        ...(previousFollowerId == null ? [] : [previousFollowerId]),
      ]);
      await this.query(
        sql,
        `INSERT INTO ${this.table("followers")}
           (bot_id, follower_id, actor_json)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (bot_id, follower_id)
         DO UPDATE SET actor_json = EXCLUDED.actor_json`,
        [identifier, followerId.href, serializeJson(followerJson)],
      );
      await this.query(
        sql,
        `INSERT INTO ${this.table("follow_requests")}
           (bot_id, follow_request_id, follower_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (bot_id, follow_request_id)
         DO UPDATE SET follower_id = EXCLUDED.follower_id`,
        [identifier, followId.href, followerId.href],
      );
      if (
        previousFollowerId != null && previousFollowerId !== followerId.href
      ) {
        await this.cleanupFollower(sql, identifier, previousFollowerId);
      }
    });
  }

  async removeFollower(
    identifier: string,
    followId: URL,
    followerId: URL,
  ): Promise<Actor | undefined> {
    await this.ensureReady();
    return await this.sql.begin(async (sql) => {
      await this.lockFollowRequest(sql, identifier, followId);
      const rows = await this.query<{ readonly actor_json: unknown }>(
        sql,
        `SELECT f.actor_json
           FROM ${this.table("follow_requests")} AS fr
           JOIN ${this.table("followers")} AS f
             ON f.bot_id = fr.bot_id AND f.follower_id = fr.follower_id
          WHERE fr.bot_id = $1
            AND fr.follow_request_id = $2
            AND fr.follower_id = $3
          FOR UPDATE`,
        [identifier, followId.href, followerId.href],
      );
      const row = rows[0];
      if (row == null) return undefined;
      await this.query(
        sql,
        `DELETE FROM ${this.table("follow_requests")}
          WHERE bot_id = $1 AND follow_request_id = $2`,
        [identifier, followId.href],
      );
      await this.cleanupFollower(sql, identifier, followerId.href);
      return await parseActor(row.actor_json);
    });
  }

  async hasFollower(identifier: string, followerId: URL): Promise<boolean> {
    await this.ensureReady();
    const rows = await this.query<{ readonly exists: number }>(
      this.sql,
      `SELECT 1 AS exists
         FROM ${this.table("followers")}
        WHERE bot_id = $1 AND follower_id = $2`,
      [identifier, followerId.href],
    );
    return rows.length > 0;
  }

  async *getFollowers(
    identifier: string,
    options: RepositoryGetFollowersOptions = {},
  ): AsyncIterable<Actor> {
    await this.ensureReady();
    const { offset = 0, limit } = options;
    const parameters: QueryParameter[] = [identifier];
    let query = `SELECT actor_json
                   FROM ${this.table("followers")}
                  WHERE bot_id = $1
               ORDER BY follower_id ASC`;
    if (limit != null) {
      parameters.push(limit, offset);
      query += ` LIMIT $${parameters.length - 1} OFFSET $${parameters.length}`;
    } else if (offset > 0) {
      parameters.push(offset);
      query += ` OFFSET $${parameters.length}`;
    }
    const rows = await this.query<{ readonly actor_json: unknown }>(
      this.sql,
      query,
      parameters,
    );
    for (const row of rows) {
      const actor = await parseActor(row.actor_json);
      if (actor != null) yield actor;
    }
  }

  async countFollowers(identifier: string): Promise<number> {
    await this.ensureReady();
    const rows = await this.query<{ readonly count: number }>(
      this.sql,
      `SELECT COUNT(*)::integer AS count
         FROM ${this.table("followers")}
        WHERE bot_id = $1`,
      [identifier],
    );
    return rows[0]?.count ?? 0;
  }

  async addSentFollow(
    identifier: string,
    id: Uuid,
    follow: Follow,
  ): Promise<void> {
    await this.ensureReady();
    await this.query(
      this.sql,
      `INSERT INTO ${this.table("sent_follows")} (bot_id, id, follow_json)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (bot_id, id)
       DO UPDATE SET follow_json = EXCLUDED.follow_json`,
      [
        identifier,
        id,
        serializeJson(await follow.toJsonLd({ format: "compact" })),
      ],
    );
  }

  async removeSentFollow(
    identifier: string,
    id: Uuid,
  ): Promise<Follow | undefined> {
    await this.ensureReady();
    const rows = await this.query<{ readonly follow_json: unknown }>(
      this.sql,
      `DELETE FROM ${this.table("sent_follows")}
        WHERE bot_id = $1 AND id = $2
    RETURNING follow_json`,
      [identifier, id],
    );
    return await parseFollow(rows[0]?.follow_json);
  }

  async getSentFollow(
    identifier: string,
    id: Uuid,
  ): Promise<Follow | undefined> {
    await this.ensureReady();
    const rows = await this.query<{ readonly follow_json: unknown }>(
      this.sql,
      `SELECT follow_json
         FROM ${this.table("sent_follows")}
        WHERE bot_id = $1 AND id = $2`,
      [identifier, id],
    );
    return await parseFollow(rows[0]?.follow_json);
  }

  async addFollowee(
    identifier: string,
    followeeId: URL,
    follow: Follow,
  ): Promise<void> {
    await this.ensureReady();
    await this.query(
      this.sql,
      `INSERT INTO ${this.table("followees")}
         (bot_id, followee_id, follow_json)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (bot_id, followee_id)
       DO UPDATE SET follow_json = EXCLUDED.follow_json`,
      [
        identifier,
        followeeId.href,
        serializeJson(await follow.toJsonLd({ format: "compact" })),
      ],
    );
  }

  async removeFollowee(
    identifier: string,
    followeeId: URL,
  ): Promise<Follow | undefined> {
    await this.ensureReady();
    const rows = await this.query<{ readonly follow_json: unknown }>(
      this.sql,
      `DELETE FROM ${this.table("followees")}
        WHERE bot_id = $1 AND followee_id = $2
    RETURNING follow_json`,
      [identifier, followeeId.href],
    );
    return await parseFollow(rows[0]?.follow_json);
  }

  async getFollowee(
    identifier: string,
    followeeId: URL,
  ): Promise<Follow | undefined> {
    await this.ensureReady();
    const rows = await this.query<{ readonly follow_json: unknown }>(
      this.sql,
      `SELECT follow_json
         FROM ${this.table("followees")}
        WHERE bot_id = $1 AND followee_id = $2`,
      [identifier, followeeId.href],
    );
    return await parseFollow(rows[0]?.follow_json);
  }

  async *findFollowedBots(followeeId: URL): AsyncIterable<string> {
    await this.ensureReady();
    const rows = await this.query<{ readonly bot_id: string }>(
      this.sql,
      `SELECT bot_id
         FROM ${this.table("followees")}
        WHERE followee_id = $1
     ORDER BY bot_id ASC`,
      [followeeId.href],
    );
    for (const row of rows) yield row.bot_id;
  }

  async vote(
    identifier: string,
    messageId: Uuid,
    voterId: URL,
    option: string,
  ): Promise<void> {
    await this.ensureReady();
    await this.query(
      this.sql,
      `INSERT INTO ${this.table("poll_votes")}
         (bot_id, message_id, voter_id, option)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (bot_id, message_id, voter_id, option)
       DO NOTHING`,
      [identifier, messageId, voterId.href, option],
    );
  }

  async countVoters(identifier: string, messageId: Uuid): Promise<number> {
    await this.ensureReady();
    const rows = await this.query<{ readonly count: number }>(
      this.sql,
      `SELECT COUNT(DISTINCT voter_id)::integer AS count
         FROM ${this.table("poll_votes")}
        WHERE bot_id = $1 AND message_id = $2`,
      [identifier, messageId],
    );
    return rows[0]?.count ?? 0;
  }

  async countVotes(
    identifier: string,
    messageId: Uuid,
  ): Promise<Readonly<Record<string, number>>> {
    await this.ensureReady();
    const rows = await this.query<{
      readonly option: string;
      readonly count: number;
    }>(
      this.sql,
      `SELECT option, COUNT(*)::integer AS count
         FROM ${this.table("poll_votes")}
        WHERE bot_id = $1 AND message_id = $2
     GROUP BY option
     ORDER BY option ASC`,
      [identifier, messageId],
    );
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.option] = row.count;
    }
    return result;
  }

  forIdentifier(identifier: string): ActorScopedRepository {
    return new ActorScopedRepository(this, identifier);
  }

  private table(name: string): string {
    return `"${this.schema}"."${name}"`;
  }

  private async lockFollowRequest(
    sql: Queryable,
    identifier: string,
    followId: URL,
  ): Promise<void> {
    await this.query(
      sql,
      `SELECT pg_catalog.pg_advisory_xact_lock($1, pg_catalog.hashtext($2))`,
      [
        followRequestAdvisoryLockNamespace,
        `${this.schema}:${identifier}:${followId.href}`,
      ],
    );
  }

  private async lockFollower(
    sql: Queryable,
    identifier: string,
    followerId: string,
  ): Promise<void> {
    await this.query(
      sql,
      `SELECT pg_catalog.pg_advisory_xact_lock($1, pg_catalog.hashtext($2))`,
      [
        followerAdvisoryLockNamespace,
        `${this.schema}:${identifier}:${followerId}`,
      ],
    );
  }

  private async lockFollowers(
    sql: Queryable,
    identifier: string,
    followerIds: readonly string[],
  ): Promise<void> {
    const uniqueFollowerIds = [...new Set(followerIds)].sort();
    for (const followerId of uniqueFollowerIds) {
      await this.lockFollower(sql, identifier, followerId);
    }
  }

  private async cleanupFollower(
    sql: Queryable,
    identifier: string,
    followerId: string,
  ): Promise<void> {
    await this.lockFollower(sql, identifier, followerId);
    await this.query(
      sql,
      `DELETE FROM ${this.table("followers")}
        WHERE bot_id = $1
          AND follower_id = $2
          AND NOT EXISTS (
            SELECT 1
              FROM ${this.table("follow_requests")}
             WHERE bot_id = $1
               AND follower_id = $2
          )`,
      [identifier, followerId],
    );
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  private async query<TRow extends object>(
    sql: Queryable,
    query: string,
    parameters: readonly QueryParameter[] = [],
  ): Promise<readonly TRow[]> {
    return await execute<TRow>(sql, query, parameters, this.prepare);
  }
}

function validateSchemaName(schema: string): string {
  if (!schemaNamePattern.test(schema)) {
    throw new TypeError("The PostgreSQL schema name is invalid.");
  }
  return schema;
}

async function execute<TRow extends object>(
  sql: Queryable,
  query: string,
  parameters: readonly QueryParameter[] = [],
  prepare = true,
): Promise<readonly TRow[]> {
  return await sql.unsafe<TRow[]>(
    query,
    [...parameters],
    { prepare },
  );
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

async function parseActivity(
  json: unknown,
): Promise<Create | Announce | undefined> {
  const normalized = normalizeJsonObject(json);
  if (normalized == null) return undefined;
  try {
    const activity = await Activity.fromJsonLd(normalized);
    if (activity instanceof Create || activity instanceof Announce) {
      return activity;
    }
  } catch (error) {
    logger.warn("Failed to parse message activity.", { error });
  }
  return undefined;
}

async function parseActor(json: unknown): Promise<Actor | undefined> {
  const normalized = normalizeJsonObject(json);
  if (normalized == null) return undefined;
  try {
    const actor = await Object.fromJsonLd(normalized);
    if (isActor(actor)) return actor;
  } catch (error) {
    logger.warn("Failed to parse follower actor.", { error });
  }
  return undefined;
}

async function parseFollow(json: unknown): Promise<Follow | undefined> {
  const normalized = normalizeJsonObject(json);
  if (normalized == null) return undefined;
  try {
    return await Follow.fromJsonLd(normalized);
  } catch (error) {
    logger.warn("Failed to parse follow activity.", { error });
  }
  return undefined;
}

function normalizeJsonObject(
  value: unknown,
): Record<string, unknown> | undefined {
  if (isJsonObject(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (isJsonObject(parsed)) return parsed;
  } catch {
    return undefined;
  }
  return undefined;
}
