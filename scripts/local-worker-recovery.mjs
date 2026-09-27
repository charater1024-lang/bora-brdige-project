const MAX_RUNTIME_ERROR_LENGTH = 500;

function defaultWait(delayMs) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
}

export function runtimeErrorMessage(event) {
  const candidates = [
    event?.cause?.cause?.message,
    event?.cause?.message,
    event?.message,
    event?.reason,
  ];
  const message = candidates.find(
    (candidate) => typeof candidate === "string" && candidate.trim().length > 0,
  );
  return (message ?? "worker_runtime_error")
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s{2,}/gu, " ")
    .trim()
    .slice(0, MAX_RUNTIME_ERROR_LENGTH);
}

export function createRuntimeRecoveryVerifier({
  isHealthy,
  onHealthy,
  onUnhealthy,
  attempts = 3,
  delayMs = 1_000,
  wait = defaultWait,
}) {
  if (
    typeof isHealthy !== "function"
    || typeof onHealthy !== "function"
    || typeof onUnhealthy !== "function"
    || typeof wait !== "function"
    || !Number.isSafeInteger(attempts)
    || attempts < 1
    || attempts > 10
    || !Number.isSafeInteger(delayMs)
    || delayMs < 0
    || delayMs > 60_000
  ) {
    throw new Error("invalid_runtime_recovery_options");
  }

  let inFlight;
  return function verify() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (await isHealthy()) {
          await onHealthy(attempt);
          return false;
        }
        if (attempt < attempts) await wait(delayMs);
      }
      await onUnhealthy();
      return true;
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}
