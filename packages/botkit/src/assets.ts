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

// Serving of BotKit's bundled front-end assets (the design-system stylesheet
// and its web fonts).  The assets are embedded as source modules under
// src/static/ (see scripts/build-assets.ts), so they need no build step or file
// system access at runtime and work identically on Deno and Node.js.
//
// Assets are served under a content-addressed path so that upgrading BotKit
// automatically busts any cached copies while allowing an aggressive,
// immutable cache lifetime.

import { fonts } from "./static/fonts.ts";
import { css } from "./static/style.ts";

/** Folds a string or a byte sequence into a running djb2 hash. */
function fold(hash: number, input: string | Uint8Array): number {
  if (typeof input === "string") {
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    }
  } else {
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash) ^ input[i];
    }
  }
  return hash;
}

/**
 * Computes a small, stable content fingerprint (djb2) rendered in base36 over
 * the full stylesheet and font contents.  It namespaces the asset paths so the
 * assets can be cached forever yet bust automatically whenever the stylesheet
 * or a font changes — including when a font's byte length stays the same, which
 * is why the actual bytes are folded in rather than just their length.
 */
function computeAssetVersion(): string {
  let hash = fold(5381, css);
  for (const [name, font] of Object.entries(fonts)) {
    hash = fold(hash, name);
    hash = fold(hash, font.bytes);
  }
  return (hash >>> 0).toString(36);
}

/**
 * The content fingerprint that namespaces the asset paths.
 * @since 0.5.0
 */
export const ASSET_VERSION = computeAssetVersion();

/**
 * The content-addressed base path under which all assets are served.
 * @since 0.5.0
 */
export const ASSET_PATH_PREFIX = `/.botkit/${ASSET_VERSION}`;

/**
 * The absolute path of the design-system stylesheet.
 * @since 0.5.0
 */
export const STYLESHEET_PATH = `${ASSET_PATH_PREFIX}/botkit.css`;

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const ETAG = `"botkit-${ASSET_VERSION}"`;
const CSS_BYTES = new TextEncoder().encode(css);

/**
 * Serves a bundled asset (the stylesheet or a web font) for a request path
 * under {@link ASSET_PATH_PREFIX}.
 *
 * Only the current content fingerprint is served, so an `immutable` response
 * always contains exactly the bytes its URL names.  A request under
 * `/.botkit/` carrying a stale or mistyped fingerprint is rejected with a `404`
 * rather than caching the current bytes under the wrong URL for a year.
 *
 * @param pathname The request URL pathname.
 * @returns A {@link Response} for the asset, a `404` response if the path is
 *          under the asset prefix but carries the wrong fingerprint or names no
 *          known asset, or `null` if the path is not an asset path at all (so
 *          the caller can keep routing).
 * @since 0.5.0
 */
export function serveAsset(pathname: string): Response | null {
  const match = /^\/\.botkit\/([^/]+)\/(.+)$/.exec(pathname);
  if (match == null) return null;
  const [, version, asset] = match;
  if (version !== ASSET_VERSION) {
    return new Response("Not Found", { status: 404 });
  }
  if (asset === "botkit.css") {
    return new Response(CSS_BYTES as Uint8Array<ArrayBuffer>, {
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        "Content-Length": CSS_BYTES.byteLength.toString(),
        "Cache-Control": IMMUTABLE_CACHE,
        "ETag": ETAG,
      },
    });
  }
  const fontMatch = /^fonts\/([A-Za-z0-9._-]+)$/.exec(asset);
  if (fontMatch != null) {
    const font = fonts[fontMatch[1]];
    if (font != null) {
      return new Response(font.bytes as Uint8Array<ArrayBuffer>, {
        headers: {
          "Content-Type": font.mediaType,
          "Content-Length": font.bytes.byteLength.toString(),
          "Cache-Control": IMMUTABLE_CACHE,
          "ETag": ETAG,
        },
      });
    }
  }
  return new Response("Not Found", { status: 404 });
}
