# AI 숙제 채점표시 관찰 설계 (현행)

> **이 문서가 AI 숙제검사 설계의 현행 기준이다.**
> PRD.md · user-flow.md · screen-route-map.md 의 "AI 판정 / 통과·미흡·애매 / 빈칸 감지 /
> 범위 누락 대조" 서술은 **구 설계**다. 충돌하면 이 문서를 따른다.
>
> - 계약 코드(원본): [`supabase/functions/ai-homework-check/observation.ts`](../supabase/functions/ai-homework-check/observation.ts)
> - 저장 구조: [`supabase/migrations/20260807030000_homework_check_observation.sql`](../supabase/migrations/20260807030000_homework_check_observation.sql)
> - 계약 테스트: [`packages/shared/test/m4Observation.test.ts`](../packages/shared/test/m4Observation.test.ts)
> - 현재 노출 차단 상태: `packages/shared/src/featureFlags.ts` 의 `AI_CHECK_RESULTS_ENABLED = false`

작성 2026-08-07. 1단계(프롬프트·스키마·배치 호출) 완료 시점.

---

## 1. 왜 바꿨나

실사진 3장으로 배포본 프롬프트를 측정했더니, **다 푼 페이지**를
`3·4·5번 미작성` 으로 `confidence 0.95` 에 단정했다.

원인은 모델 성능이 아니라 **질문의 형태**로 판단했다. 전역 판정
(`pass` / `insufficient` + 확신도 + 사유)을 요구하면 모델은 결론을 만들어야 하고,
근거가 부족할 때 그 압박이 환각으로 나온다. 확신도까지 스스로 매기게 하면
틀린 결론에 높은 숫자가 붙는다.

그래서 **관찰과 판단을 분리한다.**

| 주체 | 하는 일 | 단계 |
| --- | --- | --- |
| AI | 보이는 표시 1건당 `{ 문제번호, 표시종류, 위치 }` 만 기록 | 1단계(완료) |
| 서버 | 표시에서 상태를 계산 (표시별 파생 상태, 오답정리 조합, 충돌 판정) | 2단계 |
| 서버 | 페이지 범위 누락 계산 | 3단계 |
| 사람 | 최종 확인·수정 | 4단계 |

AI 출력은 **확정 사실이 아니다.** `raw_ai_observation` 에 원본 그대로 보관하고,
서버 계산값·사람 확인값은 별도 컬럼에 둔다.

---

## 2. 표기법 (확정)

| 표시 | 모양 | mark_type |
| --- | --- | --- |
| ○ | 손으로 그린 동그라미 | `correct_circle` |
| / | 획이 하나뿐인 사선. 추가 획 없음 | `wrong_slash` |
| △ | 사선 위에 두 획을 더해 세 변이 닫힌 삼각형 | `corrected_triangle` |
| ☆ | 오각별. 다른 표시와 별개로 그려짐 | `help_star` |
| ? | 별도로 쓴 물음표 | `help_question` |
| (구분 불가) | 사선 계열은 분명하나 획 하나/삼각형 닫힘을 구분 못 할 때 | `slash_family_unclear` |
| (그 외) | 위 어디에도 안 맞지만 위치상 채점 표시임이 명백할 때만 | `other_handwritten` |

- ☆ 와 ? 는 같은 의미다. 다만 **모양이 다르므로 mark_type 은 나눈다** — 의미 매핑은 2단계.
- △ 와 ? 는 한 문제에 함께 있을 수 있다 → 두 행.
- △ 안에 원래 사선이 보여도 **△ 하나로만** 기록한다(중복 금지).
- 채점색은 빨강이 기본이다. 그러나 **빨간색이라는 이유만으로 채점 표시로 보지 않는다** —
  모양이 목록에 맞아야 한다.

프롬프트는 **의미(맞음/틀림/모름)를 일부러 알려주지 않는다.** 의미를 주면 모델이 판정 쪽으로
끌려간다 — 그게 구 설계가 실패한 원인이다. 모양만 정확히 기술하면 관찰에 충분하다.

---

## 3. 행을 만드는 조건

네 가지를 **모두** 만족해야 `marks` 에 한 행이 생긴다.

1. 손으로 그린 표시가 실제로 보인다.
2. 그 외형을 mark_type 중 하나로 기록할 수 있다.
3. 가까운 인쇄 문제 번호를 **글자 그대로** 읽을 수 있다.
4. 그 표시가 그 번호에 속하는 것이 위치상 분명하다.

- 1·2 만 만족 → `unlinked_marks` (번호 없이 모양 + 구역).
- 표시 자체가 확인 안 되면 행 없음. **빈 배열이 정상이다.**
- 보이는 문제를 전부 열거하지 않는다. **표시가 있는 것만.**

### 기록하지 않는 것

- 인쇄된 기호: 인쇄된 ○ △ ☆ ?, 문장 끝 물음표, 객관식 선택지 번호 원
- 인쇄된 선·도형: 분수선, 도형, 그래프, 밑줄, 표 선
- 풀이 과정의 흔적: 계산 중 취소선, 풀이에 쓴 X·체크, 지운 자리

---

## 4. 출력 스키마 (`output_config.format`)

사진 1장당 한 객체:

```
{ schema_version: "obs-1",
  images: [
    { image_id:  "img-1",
      quality:   "usable" | "review" | "unusable",
      page_ref:  string | null,      // 직접 읽은 경우에만
      mark_color:"red"|"blue"|"mixed"|"other"|"unclear"|null,
      marks:          [ { problem_ref, mark_type, region } ],
      unlinked_marks: [ {              mark_type, region } ] } ] }
```

- `region` 은 사진을 가로 3 × 세로 3 으로 나눈 구역 이름. **좌표가 아니다** — 좌표는 검증할 수 없다.
- `page_ref` 는 문자열이다. 페이지 번호가 숫자가 아닐 수 있다("3-1", "II").
- `mark_color` 에 **null 이 필수다.** 표시가 없는데 색을 고르게 하면 모델이 지어낸다.
- 구조적 출력이 지원하지 않는 것: 재귀 스키마, `minItems`/`maxItems`,
  `minLength`/`maxLength`, `minimum`/`maximum`. 모든 object 에 `additionalProperties: false` 필요.
  → **배열 제약을 스키마로 쓸 수 없으므로** "unusable 이면 빈 배열", "중복 행 금지",
  "image_id 집합 일치" 는 서버가 검증한다.

---

## 5. 배치 호출

- 한 요청에 사진 **최대 4장**. 넘으면 여러 요청으로 나눈다.
- **각 이미지 바로 앞에 `image_id: img-N` 라벨 텍스트**를 둔다. 이게 없으면 모델이
  어느 결과가 어느 사진인지 붙일 근거가 없다.
- 같은 사진이 두 번 들어와도 image_id 는 다르다(순서 기반).
- `temperature: 0`, `max_tokens: 4096`.
  ⚠️ `temperature` 는 **Haiku 4.5 에서만** 쓸 수 있다. Opus 4.7+ · Sonnet 5 · Fable 5 는
  이 파라미터를 400 으로 거부한다. 모델을 올릴 때 이 줄을 함께 지워야 한다.

### 검사 범위(scope) — A/B 대상

관찰(표시를 보는 일)에 범위 텍스트가 실제로 필요한지는 측정으로 정한다.
보내는 쪽으로 구현했고, 함수 시크릿 `AI_OBSERVATION_INCLUDE_SCOPE=false` 로 끌 수 있다.
실행마다 `scope_included` 를 기록하므로 나중에 비교할 수 있다.

---

## 6. 서버 의미 검증

**실패 시 내용을 고쳐 살리지 않는다.** 중복 행을 지우거나 unusable 의 표시를 비우는 것은
"AI 가 못 한 일을 서버가 대신한 것"이고, 그 결과는 관찰이 아니라 서버의 창작이다.
배치 전체를 폐기하고 이유를 기록해 사람 확인으로 넘긴다.

| 검사 | 규칙 |
| --- | --- |
| stop_reason | **`end_turn` 일 때만 사용.** 화이트리스트다 — `max_tokens`·`refusal`·`model_context_window_exceeded`·`stop_sequence`·예상치 못한 `tool_use` 는 전부 폐기. 블랙리스트면 새 값이 생길 때 조용히 통과한다 |
| image_id | 입력과 **집합이 같고, 중복 없고, 알 수 없는 ID 없음**. **순서는 검증하지 않는다** — 서버가 입력 순서로 재정렬한다 |
| quality=unusable | `marks` 와 `unlinked_marks` 가 **모두 빈 배열**이어야 한다. 아니면 자기모순이므로 배치 폐기 |
| 중복 행 | 같은 이미지에서 `(problem_ref, mark_type, region)` 이 완전히 같은 행은 무효 |
| 열거형·problem_ref | 목록 밖 값, 빈 `problem_ref` 는 폐기 |

폐기 사유는 `ObservationDiscardReason` 열거형으로 `discard_reason` 에 남는다.

---

## 7. 실행 로깅 (실행마다 반드시)

`homework_check_attempts` 에 남긴다. **하나라도 빠지면 나중에 A/B 비교가 불가능하다.**

| 컬럼 | 내용 |
| --- | --- |
| `raw_ai_observation` | 모델 원본 JSON + 호출별 로그(image_ids/토큰/지연/폐기사유) |
| `prompt_version` | `obs-prompt-1` |
| `schema_version` | `obs-1` |
| `scope_included` | 범위를 요청에 넣었는지 |
| `model` | 응답이 알려주는 **실제** 모델 ID(요청 값이 아니라) |
| `input_tokens` / `output_tokens` / `estimated_cost_usd_micros` | 비용은 정수 마이크로달러 |
| `stop_reason` | 정상 인정 근거 |
| `latency_ms` | |
| `discard_reason` | null 이면 성공(`completed`), 있으면 폐기(`failed`) |

폐기한 원본도 보관한다 — 무엇이 왜 폐기됐는지 못 보면 프롬프트를 고칠 근거가 없다.

기록 RPC 는 `record_homework_check_observation`(service_role 전용)이다.
**`homework_submissions.ai_*` 캐시를 건드리지 않는다** — 관찰은 판정이 아니므로
화면에 캐시할 값이 없다.

`complete_homework_check_attempt`(구 판정 경로)는 DEPRECATED 다. 지우지 않은 이유:
옛 경로가 남은 코드에서 깨지고, 되돌릴 때 근거가 없어진다.

---

## 8. 1단계 스모크 결과 (2026-08-07) — 기술적 동작 확인

**정확도 증명이 아니다.** 사진 3장(+중복 1장)으로 배선이 동작하는지 확인한 것이다.
사람 정답표 16건(연결 14 + 미연결 2) 대비:

| | 배치 1회(4장) | 개별 4회 |
| --- | --- | --- |
| 문제번호·표시종류 모두 일치 | 16건 중 2건 | 16건 중 2건 |
| 문제번호는 맞고 **표시종류 틀림** | 3건 | 6건 |
| 누락 | 11건 | 8건 |
| **없는 문제번호 조작** | **0건** | **0건** |
| **없는 모양 조작** | **0건** | 2건 (오각별) |
| 전역 판정 출력 | **0건** | **0건** |

기술적으로 확인된 것: 구조적 출력 5/5 스키마 적합 · 서버 검증 5/5 통과 ·
`stop_reason` 5/5 `end_turn` · 같은 사진을 두 번 넣어도 image_id 격리 유지(내용 동일, 혼선 없음).

⚠️ **다음 단계가 알아야 할 것 — `mark_type` 은 아직 신뢰할 수 없다.**
○ 를 `wrong_slash` 로 읽는 오분류가 대량 발생했다(개별 호출에서 원 5개를 전부 사선으로).
2단계 서버 규칙은 **표시종류를 확정 사실로 다루지 말고** 사람 확인을 전제로 설계해야 한다.
`corrected_triangle` / `slash_family_unclear` 는 **측정되지 않았다** — 정답표에 삼각형이 없다.
삼각형이 있는 사진을 테스트 세트에 추가해야 한다.

측정 비용(Haiku 4.5, 1,370원/$ 기준): 4장 배치 1회 = 14.93원(장당 3.73원),
1장 호출 4회 = 28.96원(장당 7.24원). **배치가 48.4% 저렴** — 프롬프트·스키마를 4번 반복하지
않기 때문이다(입력 9,301 vs 18,304 토큰).

---

## 9. 지금 하지 않은 것

| 항목 | 단계 |
| --- | --- |
| 표시별 파생 상태, 오답정리 조합, 충돌 판정 | 2단계 |
| 페이지 범위 누락 계산 | 3단계 |
| 결과 확인·수정 화면 | 4단계 |
| 기능 플래그 해제(`AI_CHECK_RESULTS_ENABLED`) | 위 단계가 끝난 뒤 사람이 판단 |

플래그가 꺼져 있는 동안 Edge Function 은 **첫 줄에서 거절한다** — attempt 슬롯도,
사진 다운로드도, Anthropic 호출도 일어나지 않는다(비용 0).
