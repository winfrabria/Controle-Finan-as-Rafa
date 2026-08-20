import assert from "node:assert/strict";
import test from "node:test";

import { shouldAutoApplyPwaUpdate } from "../../src/components/pwa/pwa-update-policy";

test("aplica automaticamente uma versão disponível quando o app está seguro", () => {
  assert.equal(
    shouldAutoApplyPwaUpdate({
      criticalActivity: false,
      online: true,
      updateAlreadyRequested: false,
      updateAvailable: true,
    }),
    true,
  );
});

test("adia a atualização durante upload, formulário ou ausência de conexão", () => {
  const blockedStates = [
    { criticalActivity: true, online: true },
    { criticalActivity: false, online: false },
  ];

  for (const state of blockedStates) {
    assert.equal(
      shouldAutoApplyPwaUpdate({
        ...state,
        updateAlreadyRequested: false,
        updateAvailable: true,
      }),
      false,
    );
  }
});

test("não repete uma ativação já solicitada nem atualiza sem nova versão", () => {
  assert.equal(
    shouldAutoApplyPwaUpdate({
      criticalActivity: false,
      online: true,
      updateAlreadyRequested: true,
      updateAvailable: true,
    }),
    false,
  );
  assert.equal(
    shouldAutoApplyPwaUpdate({
      criticalActivity: false,
      online: true,
      updateAlreadyRequested: false,
      updateAvailable: false,
    }),
    false,
  );
});
