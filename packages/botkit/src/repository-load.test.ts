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
import assert from "node:assert/strict";
import { test } from "node:test";

test("repository module loads before Temporal is registered", async () => {
  if (typeof Deno === "undefined") return;
  const repositoryUrl = new URL(
    `./repository.ts?no-temporal=${crypto.randomUUID()}`,
    import.meta.url,
  ).href;
  const workerCode = `
    delete (globalThis as Record<string, unknown>).Temporal;
    try {
      await import(${JSON.stringify(repositoryUrl)});
      self.postMessage({ ok: true });
    } catch (error) {
      self.postMessage({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  `;
  const worker = new Worker(
    `data:application/typescript,${encodeURIComponent(workerCode)}`,
    { type: "module" },
  );
  const result = await new Promise<unknown>((resolve, reject) => {
    worker.addEventListener("message", (event: MessageEvent) => {
      resolve(event.data);
    }, { once: true });
    worker.addEventListener("error", reject, { once: true });
  });
  worker.terminate();

  assert.deepStrictEqual(result, { ok: true });
});
