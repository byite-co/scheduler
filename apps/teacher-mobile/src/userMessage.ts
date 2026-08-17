const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const INTERNAL_ERROR_PATTERN =
  /\b(PGRST\d+|PostgREST|SQLSTATE|JWT|relation|column|constraint|schema cache|duplicate key|row-level security|violates)\b/i;

export function toUserMessage(message: string) {
  if (/connection_not_pending/i.test(message)) return "이미 처리된 연결 요청입니다.";
  if (/not_connection_teacher|connection_not_found/i.test(message)) {
    return "이 연결 요청을 처리할 수 없습니다.";
  }
  if (/authentication_required/i.test(message)) return "로그인이 필요합니다.";
  if (/invalid login credentials/i.test(message)) return "이메일 또는 비밀번호를 확인해 주세요.";
  if (/email not confirmed/i.test(message)) return "이메일 인증을 마친 뒤 다시 로그인해 주세요.";
  if (/user already registered/i.test(message)) return "이미 가입된 이메일입니다.";
  if (/failed to fetch|network request failed/i.test(message)) return "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
  if (UUID_PATTERN.test(message) || INTERNAL_ERROR_PATTERN.test(message)) {
    return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return message;
}
