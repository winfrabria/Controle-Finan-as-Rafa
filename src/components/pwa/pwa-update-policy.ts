export type PwaAutoUpdateState = {
  updateAvailable: boolean;
  online: boolean;
  criticalActivity: boolean;
  updateAlreadyRequested: boolean;
};

export function shouldAutoApplyPwaUpdate({
  updateAvailable,
  online,
  criticalActivity,
  updateAlreadyRequested,
}: PwaAutoUpdateState) {
  return (
    updateAvailable &&
    online &&
    !criticalActivity &&
    !updateAlreadyRequested
  );
}
