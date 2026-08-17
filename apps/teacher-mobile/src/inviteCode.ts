const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createSecureInviteCode() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("안전한 초대 코드를 만들 수 없는 환경입니다.");
  }

  const values = new Uint32Array(6);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => INVITE_ALPHABET[value % INVITE_ALPHABET.length]).join("");
}
