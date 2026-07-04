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
  ActorScopedRepository,
  type Repository,
  type RepositoryGetFollowersOptions,
  type RepositoryGetMessagesOptions,
  type Uuid,
} from "@fedify/botkit/repository";
import { exportJwk, importJwk } from "@fedify/fedify/sig";
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
import { DatabaseSync } from "node:sqlite";

const logger = getLogger(["botkit", "sqlite"]);

/**
 * Options for creating a SQLite repository.
 * @since 0.3.0
 */
export interface SqliteRepositoryOptions {
  /**
   * The path to the SQLite database file.
   * If not provided, an in-memory database will be used.
   */
  readonly path?: string;

  /**
   * Whether to enable Write-Ahead Logging (WAL) mode.
   * @default true
   */
  readonly wal?: boolean;
}

/**
 * A repository for storing bot data using SQLite.
 * @since 0.3.0
 */
export class SqliteRepository implements Repository, Disposable {
  private readonly db: DatabaseSync;

  /**
   * Creates a new SQLite repository.
   * @param options The options for creating the repository.
   */
  constructor(options: SqliteRepositoryOptions = {}) {
    const { path = ":memory:", wal = true } = options;

    this.db = new DatabaseSync(path);

    // Enable foreign key constraints
    this.db.exec("PRAGMA foreign_keys = ON;");

    if (wal && path !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }

    this.initializeTables();
  }

  [Symbol.dispose]() {
    this.close();
  }

  /**
   * Closes the database connection.
   */
  close(): void {
    this.db.close();
  }

  private initializeTables(): void {
    // Key pairs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS key_pairs (
        id INTEGER PRIMARY KEY,
        bot_id TEXT NOT NULL,
        private_key_jwk TEXT NOT NULL,
        public_key_jwk TEXT NOT NULL
      )
    `);

    // Create index on bot_id for efficient per-bot lookup
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_key_pairs_bot_id ON key_pairs(bot_id)
    `);

    // Messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        bot_id TEXT NOT NULL,
        id TEXT NOT NULL,
        activity_json TEXT NOT NULL,
        published INTEGER,
        PRIMARY KEY (bot_id, id)
      )
    `);

    // Create index on published timestamp for efficient ordering
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_bot_published
      ON messages(bot_id, published)
    `);

    // Followers table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS followers (
        bot_id TEXT NOT NULL,
        follower_id TEXT NOT NULL,
        actor_json TEXT NOT NULL,
        PRIMARY KEY (bot_id, follower_id)
      )
    `);

    // Follow requests mapping table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS follow_requests (
        bot_id TEXT NOT NULL,
        follow_request_id TEXT NOT NULL,
        follower_id TEXT NOT NULL,
        PRIMARY KEY (bot_id, follow_request_id),
        FOREIGN KEY (bot_id, follower_id)
          REFERENCES followers(bot_id, follower_id)
      )
    `);

    // Sent follows table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sent_follows (
        bot_id TEXT NOT NULL,
        id TEXT NOT NULL,
        follow_json TEXT NOT NULL,
        PRIMARY KEY (bot_id, id)
      )
    `);

    // Followees table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS followees (
        bot_id TEXT NOT NULL,
        followee_id TEXT NOT NULL,
        follow_json TEXT NOT NULL,
        PRIMARY KEY (bot_id, followee_id)
      )
    `);

    // Create index for reverse lookup of bots following an actor
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_followees_followee_id
      ON followees(followee_id)
    `);

    // Poll votes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS poll_votes (
        bot_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        voter_id TEXT NOT NULL,
        option TEXT NOT NULL,
        PRIMARY KEY (bot_id, message_id, voter_id, option)
      )
    `);

    // Create index for efficient vote counting
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_poll_votes_bot_message_option
      ON poll_votes(bot_id, message_id, option)
    `);
  }

  async setKeyPairs(
    identifier: string,
    keyPairs: CryptoKeyPair[],
  ): Promise<void> {
    const deleteStmt = this.db.prepare(
      "DELETE FROM key_pairs WHERE bot_id = ?",
    );
    const insertStmt = this.db.prepare(`
      INSERT INTO key_pairs (bot_id, private_key_jwk, public_key_jwk)
      VALUES (?, ?, ?)
    `);

    this.db.exec("BEGIN TRANSACTION");
    try {
      deleteStmt.run(identifier);

      for (const keyPair of keyPairs) {
        const privateJwk = await exportJwk(keyPair.privateKey);
        const publicJwk = await exportJwk(keyPair.publicKey);
        insertStmt.run(
          identifier,
          JSON.stringify(privateJwk),
          JSON.stringify(publicJwk),
        );
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async getKeyPairs(identifier: string): Promise<CryptoKeyPair[] | undefined> {
    const stmt = this.db.prepare(`
      SELECT private_key_jwk, public_key_jwk FROM key_pairs
      WHERE bot_id = ? ORDER BY id
    `);
    const rows = stmt.all(identifier) as Array<{
      private_key_jwk: string;
      public_key_jwk: string;
    }>;

    if (rows.length === 0) return undefined;

    const keyPairs: CryptoKeyPair[] = [];
    for (const row of rows) {
      const privateJwk = JSON.parse(row.private_key_jwk);
      const publicJwk = JSON.parse(row.public_key_jwk);

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
    const stmt = this.db.prepare(`
      INSERT INTO messages (bot_id, id, activity_json, published)
      VALUES (?, ?, ?, ?)
    `);

    const activityJson = JSON.stringify(
      await activity.toJsonLd({ format: "compact" }),
    );
    const published = activity.published?.epochMilliseconds ?? null;

    stmt.run(identifier, id, activityJson, published);
  }

  async updateMessage(
    identifier: string,
    id: Uuid,
    updater: (
      existing: Create | Announce,
    ) => Create | Announce | undefined | Promise<Create | Announce | undefined>,
  ): Promise<boolean> {
    const selectStmt = this.db.prepare(`
      SELECT activity_json FROM messages WHERE bot_id = ? AND id = ?
    `);
    const row = selectStmt.get(identifier, id) as
      | { activity_json: string }
      | undefined;

    if (!row) return false;

    const activityData = JSON.parse(row.activity_json);
    const activity = await Activity.fromJsonLd(activityData);

    if (!(activity instanceof Create || activity instanceof Announce)) {
      return false;
    }

    const newActivity = await updater(activity);
    if (newActivity == null) return false;

    const updateStmt = this.db.prepare(`
      UPDATE messages
      SET activity_json = ?, published = ?
      WHERE bot_id = ? AND id = ?
    `);

    const newActivityJson = JSON.stringify(
      await newActivity.toJsonLd({ format: "compact" }),
    );
    const published = newActivity.published?.epochMilliseconds ?? null;

    updateStmt.run(newActivityJson, published, identifier, id);
    return true;
  }

  async removeMessage(
    identifier: string,
    id: Uuid,
  ): Promise<Create | Announce | undefined> {
    const selectStmt = this.db.prepare(`
      SELECT activity_json FROM messages WHERE bot_id = ? AND id = ?
    `);
    const row = selectStmt.get(identifier, id) as
      | { activity_json: string }
      | undefined;

    if (!row) return undefined;

    const deleteStmt = this.db.prepare(`
      DELETE FROM messages WHERE bot_id = ? AND id = ?
    `);
    deleteStmt.run(identifier, id);

    try {
      const activityData = JSON.parse(row.activity_json);
      const activity = await Activity.fromJsonLd(activityData);

      if (activity instanceof Create || activity instanceof Announce) {
        return activity;
      }
    } catch (error) {
      logger.warn("Failed to parse removed message activity", { id, error });
    }

    return undefined;
  }

  async *getMessages(
    identifier: string,
    options: RepositoryGetMessagesOptions = {},
  ): AsyncIterable<Create | Announce> {
    const { order = "newest", until, since, limit } = options;

    let sql = "SELECT activity_json FROM messages WHERE bot_id = ?";
    const params: (number | string)[] = [identifier];

    if (since != null) {
      sql += " AND published >= ?";
      params.push(since.epochMilliseconds);
    }

    if (until != null) {
      sql += " AND published <= ?";
      params.push(until.epochMilliseconds);
    }

    sql += order === "oldest"
      ? " ORDER BY published ASC"
      : " ORDER BY published DESC";

    if (limit != null) {
      sql += " LIMIT ?";
      params.push(limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{ activity_json: string }>;

    for (const row of rows) {
      try {
        const activityData = JSON.parse(row.activity_json);
        const activity = await Activity.fromJsonLd(activityData);

        if (activity instanceof Create || activity instanceof Announce) {
          yield activity;
        }
      } catch (error) {
        logger.warn("Failed to parse message activity", { error });
        continue;
      }
    }
  }

  async getMessage(
    identifier: string,
    id: Uuid,
  ): Promise<Create | Announce | undefined> {
    const stmt = this.db.prepare(`
      SELECT activity_json FROM messages WHERE bot_id = ? AND id = ?
    `);
    const row = stmt.get(identifier, id) as
      | { activity_json: string }
      | undefined;

    if (!row) return undefined;

    try {
      const activityData = JSON.parse(row.activity_json);
      const activity = await Activity.fromJsonLd(activityData);

      if (activity instanceof Create || activity instanceof Announce) {
        return activity;
      }
    } catch (error) {
      logger.warn("Failed to parse message activity", { id, error });
    }

    return undefined;
  }

  countMessages(identifier: string): Promise<number> {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM messages WHERE bot_id = ?",
    );
    const row = stmt.get(identifier) as { count: number };
    return Promise.resolve(row.count);
  }

  async addFollower(
    identifier: string,
    followRequestId: URL,
    follower: Actor,
  ): Promise<void> {
    if (follower.id == null) {
      throw new TypeError("The follower ID is missing.");
    }

    const followerJson = JSON.stringify(
      await follower.toJsonLd({ format: "compact" }),
    );

    const insertFollowerStmt = this.db.prepare(`
      INSERT OR REPLACE INTO followers (bot_id, follower_id, actor_json)
      VALUES (?, ?, ?)
    `);

    const insertRequestStmt = this.db.prepare(`
      INSERT OR REPLACE INTO follow_requests
        (bot_id, follow_request_id, follower_id)
      VALUES (?, ?, ?)
    `);

    this.db.exec("BEGIN TRANSACTION");
    try {
      insertFollowerStmt.run(identifier, follower.id.href, followerJson);
      insertRequestStmt.run(
        identifier,
        followRequestId.href,
        follower.id.href,
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async removeFollower(
    identifier: string,
    followRequestId: URL,
    actorId: URL,
  ): Promise<Actor | undefined> {
    // Check if the follow request exists and matches the actor
    const checkStmt = this.db.prepare(`
      SELECT fr.follower_id, f.actor_json
      FROM follow_requests fr
      JOIN followers f
        ON fr.bot_id = f.bot_id AND fr.follower_id = f.follower_id
      WHERE fr.bot_id = ? AND fr.follow_request_id = ? AND fr.follower_id = ?
    `);

    const row = checkStmt.get(
      identifier,
      followRequestId.href,
      actorId.href,
    ) as
      | {
        follower_id: string;
        actor_json: string;
      }
      | undefined;

    if (!row) return undefined;

    // Remove the follower and follow request
    const deleteRequestStmt = this.db.prepare(`
      DELETE FROM follow_requests WHERE bot_id = ? AND follow_request_id = ?
    `);

    const deleteFollowerStmt = this.db.prepare(`
      DELETE FROM followers WHERE bot_id = ? AND follower_id = ?
    `);

    this.db.exec("BEGIN TRANSACTION");
    try {
      deleteRequestStmt.run(identifier, followRequestId.href);
      deleteFollowerStmt.run(identifier, actorId.href);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    try {
      const actorData = JSON.parse(row.actor_json);
      const actor = await Object.fromJsonLd(actorData);

      if (isActor(actor)) {
        return actor;
      }
    } catch (error) {
      logger.warn("Failed to parse removed follower actor", { error });
    }

    return undefined;
  }

  hasFollower(identifier: string, followerId: URL): Promise<boolean> {
    const stmt = this.db.prepare(`
      SELECT 1 FROM followers WHERE bot_id = ? AND follower_id = ?
    `);
    const row = stmt.get(identifier, followerId.href);
    return Promise.resolve(row != null);
  }

  async *getFollowers(
    identifier: string,
    options: RepositoryGetFollowersOptions = {},
  ): AsyncIterable<Actor> {
    const { offset = 0, limit } = options;

    let sql =
      "SELECT actor_json FROM followers WHERE bot_id = ? ORDER BY follower_id";
    const params: (number | string)[] = [identifier];

    if (limit != null) {
      sql += " LIMIT ? OFFSET ?";
      params.push(limit, offset);
    } else if (offset > 0) {
      sql += " LIMIT -1 OFFSET ?";
      params.push(offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as { actor_json: string }[];

    for (const row of rows) {
      try {
        const actorData = JSON.parse(row.actor_json);
        const actor = await Object.fromJsonLd(actorData);

        if (isActor(actor)) {
          yield actor;
        }
      } catch (error) {
        logger.warn("Failed to parse follower actor", { error });
        continue;
      }
    }
  }

  countFollowers(identifier: string): Promise<number> {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM followers WHERE bot_id = ?",
    );
    const row = stmt.get(identifier) as { count: number };
    return Promise.resolve(row.count);
  }

  async addSentFollow(
    identifier: string,
    id: Uuid,
    follow: Follow,
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sent_follows (bot_id, id, follow_json)
      VALUES (?, ?, ?)
    `);

    const followJson = JSON.stringify(
      await follow.toJsonLd({ format: "compact" }),
    );

    stmt.run(identifier, id, followJson);
  }

  async removeSentFollow(
    identifier: string,
    id: Uuid,
  ): Promise<Follow | undefined> {
    const follow = await this.getSentFollow(identifier, id);
    if (follow == null) return undefined;

    const stmt = this.db.prepare(
      "DELETE FROM sent_follows WHERE bot_id = ? AND id = ?",
    );
    stmt.run(identifier, id);

    return follow;
  }

  async getSentFollow(
    identifier: string,
    id: Uuid,
  ): Promise<Follow | undefined> {
    const stmt = this.db.prepare(`
      SELECT follow_json FROM sent_follows WHERE bot_id = ? AND id = ?
    `);
    const row = stmt.get(identifier, id) as
      | { follow_json: string }
      | undefined;

    if (!row) return undefined;

    try {
      const followData = JSON.parse(row.follow_json);
      return await Follow.fromJsonLd(followData);
    } catch (error) {
      logger.warn("Failed to parse sent follow activity", { id, error });
      return undefined;
    }
  }

  async addFollowee(
    identifier: string,
    followeeId: URL,
    follow: Follow,
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO followees (bot_id, followee_id, follow_json)
      VALUES (?, ?, ?)
    `);

    const followJson = JSON.stringify(
      await follow.toJsonLd({ format: "compact" }),
    );

    stmt.run(identifier, followeeId.href, followJson);
  }

  async removeFollowee(
    identifier: string,
    followeeId: URL,
  ): Promise<Follow | undefined> {
    const follow = await this.getFollowee(identifier, followeeId);
    if (follow == null) return undefined;

    const stmt = this.db.prepare(
      "DELETE FROM followees WHERE bot_id = ? AND followee_id = ?",
    );
    stmt.run(identifier, followeeId.href);

    return follow;
  }

  async getFollowee(
    identifier: string,
    followeeId: URL,
  ): Promise<Follow | undefined> {
    const stmt = this.db.prepare(`
      SELECT follow_json FROM followees WHERE bot_id = ? AND followee_id = ?
    `);
    const row = stmt.get(identifier, followeeId.href) as
      | { follow_json: string }
      | undefined;

    if (!row) return undefined;

    try {
      const followData = JSON.parse(row.follow_json);
      return await Follow.fromJsonLd(followData);
    } catch (error) {
      logger.warn("Failed to parse followee activity", {
        followeeId: followeeId.href,
        error,
      });
      return undefined;
    }
  }

  async *findFollowedBots(followeeId: URL): AsyncIterable<string> {
    const stmt = this.db.prepare(`
      SELECT bot_id FROM followees WHERE followee_id = ? ORDER BY bot_id
    `);
    const rows = stmt.all(followeeId.href) as { bot_id: string }[];
    for (const row of rows) yield row.bot_id;
  }

  vote(
    identifier: string,
    messageId: Uuid,
    voterId: URL,
    option: string,
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO poll_votes (bot_id, message_id, voter_id, option)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(identifier, messageId, voterId.href, option);
    return Promise.resolve();
  }

  countVoters(identifier: string, messageId: Uuid): Promise<number> {
    const stmt = this.db.prepare(`
      SELECT COUNT(DISTINCT voter_id) as count
      FROM poll_votes
      WHERE bot_id = ? AND message_id = ?
    `);
    const row = stmt.get(identifier, messageId) as { count: number };
    return Promise.resolve(row.count);
  }

  countVotes(
    identifier: string,
    messageId: Uuid,
  ): Promise<Readonly<Record<string, number>>> {
    const stmt = this.db.prepare(`
      SELECT option, COUNT(*) as count
      FROM poll_votes
      WHERE bot_id = ? AND message_id = ?
      GROUP BY option
    `);
    const rows = stmt.all(identifier, messageId) as Array<{
      option: string;
      count: number;
    }>;

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.option] = row.count;
    }

    return Promise.resolve(result);
  }

  forIdentifier(identifier: string): ActorScopedRepository {
    return new ActorScopedRepository(this, identifier);
  }
}
