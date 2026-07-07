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
/** @jsxImportSource hono/jsx */
import type { BotImpl } from "../bot-impl.ts";

export interface FollowButtonProps {
  readonly bot: BotImpl<unknown>;
  readonly action?: string;
}

export function FollowButton({ bot, action }: FollowButtonProps) {
  const name = bot.name ?? bot.username;
  // The trigger and dialog use relative DOM traversal instead of shared ids or
  // a global, so several FollowButtons can coexist on one page without colliding.
  return (
    <>
      <button
        type="button"
        class="bk-btn bk-btn--primary"
        onclick="this.nextElementSibling.showModal()"
      >
        <span class="bk-btn__key" aria-hidden="true">+</span> Follow
      </button>
      <dialog class="bk-dialog">
        <div class="bk-dialog__head">
          <h2 class="bk-dialog__title">Follow {name}</h2>
          <button
            type="button"
            class="bk-dialog__close"
            aria-label="Close"
            onclick="this.closest('dialog').close()"
          >
            &times;
          </button>
        </div>
        <div class="bk-dialog__body">
          <p>
            Enter your fediverse handle and we'll send you to your own server to
            confirm.
          </p>
          <form action={action ?? "/follow"} method="post">
            <label class="bk-field">
              <span class="bk-field__label">Your handle</span>
              <input
                type="text"
                name="handle"
                class="bk-input"
                placeholder="@you@mastodon.example"
                autocomplete="off"
                autocapitalize="none"
                spellcheck={false}
                required
              />
            </label>
            <button type="submit" class="bk-btn bk-btn--primary">
              Continue
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
