import assert from "node:assert/strict";
import test from "node:test";

import { isSameOriginMutation } from "./same-origin";

test("aceita mutação same-origin e recusa origem externa", () => {
  assert.equal(
    isSameOriginMutation(
      new Request("https://winfrabr.test/api/push/subscriptions", {
        headers: {
          Origin: "https://winfrabr.test",
          "Sec-Fetch-Site": "same-origin",
        },
        method: "POST",
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginMutation(
      new Request("https://winfrabr.test/api/push/subscriptions", {
        headers: {
          Origin: "https://evil.test",
          "Sec-Fetch-Site": "cross-site",
        },
        method: "POST",
      }),
    ),
    false,
  );
});
