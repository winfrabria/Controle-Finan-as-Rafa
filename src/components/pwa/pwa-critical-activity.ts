export const PWA_CRITICAL_ACTIVITY_EVENT =
  "winfrabr:pwa-critical-activity";

export type PwaCriticalActivityDetail = {
  active: boolean;
  count: number;
};

function currentCount() {
  if (typeof document === "undefined") return 0;
  const parsed = Number.parseInt(
    document.documentElement.dataset.pwaCriticalActivityCount ?? "0",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function publishCount(count: number) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const normalized = Math.max(0, count);
  document.documentElement.dataset.pwaCriticalActivity =
    normalized > 0 ? "true" : "false";
  if (normalized > 0) {
    document.documentElement.dataset.pwaCriticalActivityCount = String(normalized);
  } else {
    delete document.documentElement.dataset.pwaCriticalActivityCount;
  }
  window.dispatchEvent(
    new CustomEvent<PwaCriticalActivityDetail>(PWA_CRITICAL_ACTIVITY_EVENT, {
      detail: { active: normalized > 0, count: normalized },
    }),
  );
}

export function beginPwaCriticalActivity() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  publishCount(currentCount() + 1);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    publishCount(currentCount() - 1);
  };
}

export function isPwaCriticalActivityActive() {
  return currentCount() > 0;
}
