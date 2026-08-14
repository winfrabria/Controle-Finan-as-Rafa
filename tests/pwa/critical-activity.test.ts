import assert from "node:assert/strict";
import test from "node:test";

import {
  beginPwaCriticalActivity,
  isPwaCriticalActivityActive,
  PWA_CRITICAL_ACTIVITY_EVENT,
  type PwaCriticalActivityDetail,
} from "../../src/components/pwa/pwa-critical-activity";

test("atividades críticas concorrentes mantêm o bloqueio até a última finalizar", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fakeWindow = new EventTarget();
  const dataset: DOMStringMap = {};
  const events: PwaCriticalActivityDetail[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { dataset } },
  });
  fakeWindow.addEventListener(PWA_CRITICAL_ACTIVITY_EVENT, (event) => {
    events.push((event as CustomEvent<PwaCriticalActivityDetail>).detail);
  });

  try {
    const finishFirst = beginPwaCriticalActivity();
    const finishSecond = beginPwaCriticalActivity();
    assert.equal(isPwaCriticalActivityActive(), true);
    assert.equal(dataset.pwaCriticalActivityCount, "2");

    finishFirst();
    assert.equal(isPwaCriticalActivityActive(), true);
    assert.equal(dataset.pwaCriticalActivityCount, "1");

    finishFirst();
    assert.equal(dataset.pwaCriticalActivityCount, "1");

    finishSecond();
    assert.equal(isPwaCriticalActivityActive(), false);
    assert.equal(dataset.pwaCriticalActivity, "false");
    assert.equal(dataset.pwaCriticalActivityCount, undefined);
    assert.deepEqual(events.map(({ count }) => count), [1, 2, 1, 0]);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      delete (globalThis as { document?: unknown }).document;
    }
  }
});

test("atividade crítica é segura durante renderização no servidor", () => {
  const finish = beginPwaCriticalActivity();
  assert.equal(isPwaCriticalActivityActive(), false);
  assert.doesNotThrow(finish);
});
