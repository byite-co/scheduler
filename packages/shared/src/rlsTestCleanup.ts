// 통합 테스트가 만든 임시 계정 정리 — 핵심은 "조용히 실패하지 않게" 하는 것이다.
//
// ── 왜 단순히 순서만 정해서는 안 되는가 ──────────────────────────────────────
// (2026-08-09 갱신) 아래에 적힌 "절 없음" 두 건은 **20260809010000/020000 에서 해소됐다.**
// profiles 를 참조하는 FK 중 ON DELETE 절이 없는 것은 이제 0개다(todos.created_by,
// connections.requested_by, reports.teacher_id, invite_codes.used_by 전부 SET NULL).
// 그래서 프로덕션 delete_my_account() 도, 이 정리기도 순서에 덜 민감해졌다.
// 그래도 재시도 구조는 남긴다 — 앞으로 절 없는 FK 가 다시 생겨도 조용히 새지 않게 하는
// 안전망이고, "정리 실패를 반드시 드러낸다"는 목적은 그대로 유효하다.
//
// [해소 전 상태 — 왜 이 구조가 필요했는지의 기록]
//   todos.created_by           references profiles(id)                    ← 절 없음
//   connections.requested_by   references profiles(id)                    ← 절 없음
//   todos.student_id           references profiles(id) on delete cascade
//   connections.teacher_id     references profiles(id) on delete cascade
//   connections.student_id     references profiles(id) on delete cascade
//
// 게다가 Postgres 는 한 삭제에 걸린 FK 트리거를 **제약 이름 알파벳순**으로 실행한다.
// connections 한 행이 student 를 student_id(CASCADE)와 requested_by(NO ACTION) 양쪽으로
// 참조할 때, `connections_requested_by_fkey` 가 `connections_student_id_fkey` 보다 먼저
// 발동해 "아직 남아 있는" 행을 보고 삭제를 거부한다. 교사를 먼저 지우면 teacher_id 의
// CASCADE 가 그 행을 없애므로 학생이 지워진다.
//
// 즉 **올바른 삭제 순서가 테스트마다 다르다** — m1 은 교사 먼저, m2·m4 는 학생 먼저여야
// 한다(교사가 만든 todos.created_by 때문). 하나의 순서 규칙으로는 양쪽을 만족할 수 없다.
//
// 그래서 순서를 맞추려 하지 않고, **지워지는 것부터 지우고 다시 시도**한다. 한 번 통과할
// 때마다 남은 계정의 의존성이 풀리므로, 진전이 없을 때까지 반복하면 순서와 무관하게 정리된다.
//
// ── 왜 실패를 기록하는가 ─────────────────────────────────────────────────────
// 원래 코드는 `deleteUser` 의 실패를 확인하지 않았다. 그래서 교사 계정이 원격에 55건이나
// 쌓였는데 아무도 몰랐다. 정리 실패는 반드시 드러나야 한다.

type DeleteResult = { error: { message?: string } | null };
type AdminLike = { auth: { admin: { deleteUser(id: string): Promise<DeleteResult> } } };

const leaked: string[] = [];

function describeError(error: { message?: string } | null): string {
  if (!error) return "(원인 미상)";
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * 테스트 계정을 지운다. 넘긴 순서는 힌트일 뿐이고, 정확성은 순서에 의존하지 않는다 —
 * 지워지는 것부터 지우고, 진전이 있는 동안 반복한다.
 *
 * 진전이 멈추면(= 남은 전부가 실패) 그 실패를 기록하고 빠져나온다.
 * 기록은 `assertNoLeakedTestUsers` 가 터뜨린다.
 */
export async function deleteTestUsers(admin: AdminLike, ids: Array<string | undefined | null>): Promise<void> {
  let remaining = ids.filter((id): id is string => Boolean(id));

  while (remaining.length > 0) {
    const failed: string[] = [];
    const errors = new Map<string, string>();

    for (const id of remaining) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        failed.push(id);
        errors.set(id, describeError(error));
      }
    }

    // 이번 회차에 하나도 못 지웠다면 더 반복해도 같다 → 기록하고 종료.
    if (failed.length === remaining.length) {
      for (const id of failed) leaked.push(`${id} — ${errors.get(id) ?? "(원인 미상)"}`);
      return;
    }

    remaining = failed;
  }
}

/**
 * `afterAll` 에 걸어 둔다.
 *
 * 정리 실패를 `finally` 안에서 throw 하면 원래 테스트가 실패한 이유를 덮어써 버린다
 * (`try { throw A } finally { throw B }` → A 가 사라진다). 그래서 실패는 따로 모아
 * 여기서 터뜨린다 — 테스트 본체의 실패 원인과 정리 실패가 각각 보고된다.
 */
export function assertNoLeakedTestUsers(): void {
  if (leaked.length === 0) return;
  const detail = leaked.join("\n  ");
  leaked.length = 0; // 다음 파일에 번지지 않게 비운다.
  throw new Error(
    "테스트 계정이 원격 DB 에 남았습니다(정리 실패).\n" +
      "profiles 를 참조하는 새 FK 에 ON DELETE 절이 빠졌는지 확인하세요:\n  " +
      detail
  );
}
