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
import type { JSX } from "hono/jsx/jsx-runtime";
import { STYLESHEET_PATH } from "../assets.ts";
import type { BotImpl } from "../bot-impl.ts";

/**
 * The solid accent color per theme name, mirrored from the design system's
 * accent presets.  Used only for the `theme-color` meta hint that tints mobile
 * browser chrome; the pages themselves derive every color from CSS.
 */
const ACCENT_HEX: Record<string, string> = {
  amber: "#ffbf00",
  azure: "#0172ad",
  blue: "#2060df",
  cyan: "#047878",
  fuchsia: "#c1208b",
  green: "#398712",
  grey: "#ababab",
  indigo: "#524ed2",
  jade: "#007a50",
  lime: "#a5d601",
  orange: "#d24317",
  pink: "#d92662",
  pumpkin: "#ff9500",
  purple: "#9236a4",
  red: "#c52f21",
  sand: "#ccc6b4",
  slate: "#525f7a",
  violet: "#7540bf",
  yellow: "#f2df0d",
  zinc: "#646b79",
};

export interface LayoutProps extends JSX.ElementChildrenAttribute {
  readonly bot: BotImpl<unknown>;
  readonly host: string;
  readonly title?: string;
  readonly activityLink?: string | URL;
  readonly feedLink?: string | URL;
}

export function Layout(
  { bot, host, title, activityLink, feedLink, children }: LayoutProps,
) {
  const handle = `@${bot.username}@${host}`;
  const themeColor = ACCENT_HEX[bot.pages.color] ?? ACCENT_HEX.green;
  return (
    <html
      lang="en"
      data-botkit-color={bot.pages.color}
      data-theme={bot.pages.theme === "auto" ? undefined : bot.pages.theme}
    >
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content={themeColor} />
        <meta name="generator" content="BotKit" />
        <title>
          {title != null && `${title} — `}
          {bot.name == null ? handle : `${bot.name} (${handle})`}
        </title>
        {activityLink &&
          (
            <link
              rel="alternate"
              type="application/activity+json"
              href={activityLink.toString()}
              title="ActivityPub"
            />
          )}
        {feedLink && (
          <link
            rel="alternate"
            type="application/atom+xml"
            href={feedLink.toString()}
            title="Atom feed"
          />
        )}
        <link rel="stylesheet" href={STYLESHEET_PATH} />
        <style dangerouslySetInnerHTML={{ __html: bot.pages.css }} />
      </head>
      <body class="bk-page">
        <div class="bk-container">
          {children}
          <BotKitCredit />
        </div>
      </body>
    </html>
  );
}

/** The quiet, honest attribution shown in the footer of hosted bot pages. */
export function BotKitCredit() {
  return (
    <footer class="bk-credit">
      Powered by <a href="https://botkit.fedify.dev/" rel="noopener">BotKit</a>
    </footer>
  );
}

/** A copy-to-clipboard glyph. */
export function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="5.5"
        y="5.5"
        width="8"
        height="8"
        rx="1.5"
        stroke="currentColor"
        stroke-width="1.3"
      />
      <path
        d="M10.5 3.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5"
        stroke="currentColor"
        stroke-width="1.3"
      />
    </svg>
  );
}

/** An Atom/RSS feed glyph. */
export function FeedIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2zm1.5 2.5c5.523 0 10 4.477 10 10a1 1 0 1 1-2 0a8 8 0 0 0-8-8a1 1 0 0 1 0-2m0 4a6 6 0 0 1 6 6a1 1 0 1 1-2 0a4 4 0 0 0-4-4a1 1 0 0 1 0-2m.5 7a1.5 1.5 0 1 1 0-3a1.5 1.5 0 0 1 0 3"
      />
    </svg>
  );
}
