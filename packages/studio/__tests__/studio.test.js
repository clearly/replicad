import assert from "node:assert/strict";
import test from "node:test";

import { CHANNEL } from "../src/external/protocol.js";

test("studio external control channel is namespaced", () => {
  assert.equal(CHANNEL, "replicad-studio");
});
