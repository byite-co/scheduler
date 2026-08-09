export function getInviteExpiry(expiresAt: string, now = new Date()) {
  const hours = Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 3600000);
  if (hours <= 0) return { state: "expired" as const, label: "만료됨" };
  if (hours <= 3) return { state: "urgent" as const, label: `${hours}시간 남음` };
  return { state: "valid" as const, label: `${hours}시간 남음` };
}
