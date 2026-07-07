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
/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
import { type Actor, getActorHandle, Link } from "@fedify/vocab";
import type { Session } from "../session.ts";

export interface FollowerProps {
  readonly actor: Actor;
  readonly session: Session<unknown>;
}

export async function Follower({ actor, session }: FollowerProps) {
  const { context } = session;
  const author = actor;
  const authorIcon = await actor?.getIcon({
    documentLoader: context.documentLoader,
    contextLoader: context.contextLoader,
    suppressError: true,
  });
  if (author?.id == null) {
    return (
      <div class="bk-actor">
        <span class="bk-actor__ph" />
        <em class="bk-actor__name">deleted account</em>
      </div>
    );
  }
  const authorHandle = await getActorHandle(author);
  const iconUrl = authorIcon?.url == null
    ? null
    : authorIcon.url instanceof Link
    ? authorIcon.url.href?.href
    : authorIcon.url.href;
  return (
    <a
      class="bk-actor"
      href={author.url?.href?.toString() ?? author.id.href}
    >
      {iconUrl
        ? (
          <img
            src={iconUrl}
            alt={authorIcon?.name?.toString() ?? undefined}
            loading="lazy"
          />
        )
        : <span class="bk-actor__ph" />}
      <span class="bk-actor__info">
        <span class="bk-actor__name">{author.name?.toString()}</span>
        <span class="bk-actor__handle">{authorHandle}</span>
      </span>
    </a>
  );
}
