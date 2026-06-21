export const PRICE_STUDENT_PREMIUM_KRW = 2900;
export const PRICE_PER_STUDENT_KRW = 2900;

export function getTeacherMonthlySubscriptionAmount(
  activeConnectionCount: number
): number {
  if (!Number.isInteger(activeConnectionCount) || activeConnectionCount < 0) {
    throw new Error("activeConnectionCount must be a non-negative integer");
  }

  return activeConnectionCount * PRICE_PER_STUDENT_KRW;
}
