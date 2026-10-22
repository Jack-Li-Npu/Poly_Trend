import assert from "node:assert/strict";
import test from "node:test";
import { safeSourceUrl, probability, observedChange } from "./format.ts";

test("evidence URLs reject executable and local schemes", () => {
  for (const source of [
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "file:///private/key",
    "//untrusted.example/file",
    "not a URL",
  ]) {
    assert.equal(safeSourceUrl(source), null);
  }
});

test("evidence URLs remove credentials while retaining identifying source parameters", () => {
  const source = safeSourceUrl(
    "https://user:password@example.com/release?series=GDP&api_key=private&access_token=private&date=2026-10-01",
  );
  assert.equal(
    source,
    "https://example.com/release?series=GDP&date=2026-10-01",
  );
});

test("missing probability remains missing, while genuine zero is displayed", () => {
  assert.equal(probability(null), "—");
  assert.equal(probability(undefined), "—");
  assert.equal(probability(Number.NaN), "—");
  assert.equal(probability(0), "0%");
});

test("yield changes use basis points, including a zero baseline, while price changes use fractional returns", () => {
  assert.equal(observedChange(0, 0.25, true), 25);
  assert.ok(Math.abs(observedChange(4.5, 4.75, true) - 25) < 1e-10);
  assert.ok(Math.abs(observedChange(100, 105, false) - 0.05) < 1e-10);
  assert.equal(observedChange(0, 105, false), null);
});
