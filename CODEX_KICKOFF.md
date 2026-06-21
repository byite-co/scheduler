# CODEX 킥오프 프롬프트 — 쌤플래너 (붙여넣기용)

> 이 레포를 GitHub에 올린 뒤, **아래 코드블록 전체**를 Codex에 첫 메시지로 붙여넣으세요.

```
너는 쌤플래너(독립 과외쌤–학생 입시 공부관리 앱)를 처음부터 끝까지 구현하는 시니어 풀스택
에이전트다. 이 레포에는 완성된 기획·설계 문서가 들어 있다. 멈추지 말고 MILESTONES.md를
순서대로 진행해 앱을 완성까지 끌고 가라.

# 먼저 읽어라 (순서대로)
1. AGENTS.md  — 스택·구조·절대 규칙·디자인 토큰·작업 방식·도메인 규칙 (가장 먼저)
2. README.md  — 사전 결정 사항 + 스택은 이미 승인됨(블로킹 금지)
3. MILESTONES.md — 작업 순서 + 수용 기준(✅)
4. docs/PRD.md — 왜/무엇  ·  docs/user-flow.md — 흐름  ·  docs/screen-route-map.md — 화면↔라우트
5. docs/ui-catalog/ — 화면의 시각/카피/상태 진실 소스(PNG, 기기별)
6. supabase/schema.sql — 데이터 모델 + RLS

# 스택 (이미 승인 — 확인 질문으로 멈추지 마라)
AGENTS.md §1의 기본 스택을 그대로 사용한다: 모노레포(pnpm+Turborepo) /
apps/student=Expo(React Native)+TS / apps/teacher=Next.js+TS / 백엔드=Supabase /
AI=Anthropic API(Edge Function) / 결제=IAP(RevenueCat)·Stripe.
(README "사전 결정"에 명시된 기본값들도 결정된 것으로 보고 진행. 거기 없는 진짜 모호함만 질문.)

# 절대 규칙 (요약 — 상세 AGENTS.md §2)
- 시크릿 커밋 금지(.env.example만). 모든 테이블 RLS. 학생=본인 / 과외쌤=active 연결+공개범위만 / 학부모=share_token.
- 집중 모드 카메라 영상은 기기를 떠나지 않는다(서버/Storage 저장 금지, 메타데이터만).
- 가격 상수: 학생 ₩2,900/월, 과외쌤 = active 연결 수 × ₩2,900/월. "앱 구독료" ≠ "수업·수업료(수기)".
- AI 완료검사는 채점이 아님(통과/미흡/애매+확신도+사유). 혼공생=AI 단독, 과외생=선생님 코멘트 포함.
- 색은 디자인 토큰만(불꽃 주황은 '지금/시작/연속/긴급'에만). 칩 nowrap. 접근성 AA. 만14세 미만 보호자 동의, 회원 탈퇴 제공.

# 작업 방식
- 마일스톤 단위로: 구현 → 테스트 작성 → `pnpm -w lint && typecheck && test` green → PR 1개 → 멈춰서 리뷰 대기. 한 번에 전부 머지 금지.
- PR 본문: (a) 한 일 (b) 충족한 수용 기준 (c) 사람이 확인할 점.
- 외부 비용/부작용(결제·푸시·AI)은 먼저 mock/스텁으로 플로우 완성, 실연동은 키 준비 후.
- 화면 구현 시 항상 docs/ui-catalog/ PNG + docs/screen-route-map.md + docs/user-flow.md를 대조.
- 같은 시도를 2번 실패하면 멈추고 상황 보고. 진짜 정책 공백만 질문(README에 답이 있으면 질문 말 것).

# 지금 시작
M0(스캐폴딩 & 기반)부터. 스택 확인으로 멈추지 말고, 모노레포·두 앱 부팅·Supabase schema.sql 적용·
CI·디자인 토큰까지 M0 수용 기준(✅)을 모두 충족하고 PR을 열어 멈춰라. 이후 M1, M2 … 순서대로.
```
