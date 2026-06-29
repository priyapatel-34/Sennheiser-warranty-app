/**
 * Structured logging for Extended Warranty flows.
 * Every rejection/eligibility decision should log context for QA and production debugging.
 */
export function logEw(event, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...details,
  };
  console.log(JSON.stringify(payload));
}
