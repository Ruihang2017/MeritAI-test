/**
 * Client-side backstop for the "no pay calculations" rule (plan P4). The model
 * is told never to total up pay; if a reply still contains pay arithmetic,
 * the UI shows a warning. It flags the reply rather than blocking it, like
 * the unverified-link guard.
 */

// "6 hours × $60.93", "$60.93 x 6", "= $365.58", "total pay of $...", "you owe her $365".
const PATTERNS: RegExp[] = [
  /\d+(\.\d+)?\s*(hours?|hrs?|h)\s*(×|x|\*)\s*\$\s?\d/i,
  /\$\s?\d[\d,]*(\.\d+)?\s*(×|x|\*)\s*\d/i,
  // "= $" only after a number, so "base rate = $30.00" is not flagged.
  /\d\s*=\s*\$\s?\d/,
  /\btotal (pay|wages?|cost|gross)\b[^.\n]{0,20}\$\s?\d/i,
  /\byou owe (him|her|them)\b[^.\n]{0,20}\$\s?\d/i,
  /\b(amount (owed|due|payable)|gross (pay|wages?|amount)|pay for (the|this|that) shift|shift (total|pay))\b[^.\n]{0,20}\$\s?\d/i,
];

export function looksLikePayCalculation(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}

export const PAY_GUARD_WARNING =
  "This reply contains a pay calculation. The assistant is not a pay calculator: check the amount with the Fair Work Pay and Conditions Tool (calculate.fairwork.gov.au) before you pay.";
