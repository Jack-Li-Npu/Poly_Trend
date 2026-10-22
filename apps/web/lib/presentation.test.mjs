import assert from "node:assert/strict";
import test from "node:test";
import { presentationForRun } from "./presentation.ts";

test("historical display never falls back to a future-bearing raw snapshot", () => {
  const raw = {
    markets: [{ probability: 0.9, as_of: "2026-10-22T12:00:00Z" }],
  };
  const detail = {
    run: { as_of: "2026-10-01T00:00:00Z" },
    bundle: raw,
    presentation: null,
  };
  assert.equal(presentationForRun(detail), null);
});

test("historical display uses its server-filtered presentation while raw export remains pinned", () => {
  const raw = { markets: [{ probability: 0.9 }] };
  const filtered = { markets: [{ probability: 0.3 }] };
  const detail = {
    run: { as_of: "2026-10-01T00:00:00Z" },
    bundle: raw,
    presentation: filtered,
  };
  assert.equal(presentationForRun(detail), filtered);
  assert.equal(detail.bundle, raw);
});

test("ordinary run remains renderable when only its pinned input bundle is supplied", () => {
  const raw = { markets: [] };
  assert.equal(presentationForRun({ run: { as_of: null }, bundle: raw }), raw);
});
