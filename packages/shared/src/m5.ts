// M5 — AI 공부량 추천 · 리포트 · 학부모 공유의 순수 로직.
// 추천/리포트 초안은 키 준비 전까지 결정적 스텁(고정 응답). 실연동은 Edge Function으로 교체.

import { hasActiveStudentPremium, type StudentSubscriptionLike } from "./m6";
import { SUBJECT_LABELS, type SubjectCode } from "./subjects";

export type UnlockFeature = "report" | "ai_check" | "ai_rec";

export type StudyRecommendation = {
  subject: SubjectCode;
  recommendedHours: number;
  reason: string;
};

export type StudyRecommendationInput = {
  recentMinutesBySubject: Partial<Record<SubjectCode, number>>;
  subjects: SubjectCode[];
};

// 결정적 스텁: 최근 공부량 대비 +2시간(주) 권장, 2~15시간으로 클램프. 코호트 비교는 실연동 시.
export function getStubStudyRecommendation(input: StudyRecommendationInput): StudyRecommendation[] {
  return input.subjects.map((subject) => {
    const recentHours = Math.max(0, Math.round((input.recentMinutesBySubject[subject] ?? 0) / 60));
    const recommendedHours = Math.min(15, Math.max(2, recentHours + 2));
    return {
      subject,
      recommendedHours,
      reason: `최근 주 ${recentHours}시간 대비 +${recommendedHours - recentHours}시간을 추천해요. (자동 추천 미리보기)`
    };
  });
}

export type WeeklyStudySessionLike = {
  subject: SubjectCode | null;
  duration_sec: number;
  started_at: string;
};

export type WeeklyAggregate = {
  totalMinutes: number;
  perSubjectMinutes: Array<{ subject: SubjectCode; minutes: number }>;
  perDayMinutes: number[]; // 일~토 (7칸)
};

// 리포트 차트용 집계. 시작일(weekStartKey: YYYY-MM-DD, 일요일 기준) 한 주.
export function aggregateWeeklyStudy(
  sessions: WeeklyStudySessionLike[],
  weekStartKey: string
): WeeklyAggregate {
  const start = new Date(`${weekStartKey}T00:00:00.000Z`);
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  const perSubject = new Map<SubjectCode, number>();
  let total = 0;

  for (const session of sessions) {
    const minutes = Math.max(0, Math.round(session.duration_sec / 60));
    if (minutes === 0) continue;
    const started = new Date(session.started_at);
    const dayIndex = Math.floor((started.getTime() - start.getTime()) / 86_400_000);
    if (dayIndex < 0 || dayIndex > 6) continue;
    perDay[dayIndex] += minutes;
    total += minutes;
    if (session.subject) perSubject.set(session.subject, (perSubject.get(session.subject) ?? 0) + minutes);
  }

  return {
    totalMinutes: total,
    perDayMinutes: perDay,
    perSubjectMinutes: [...perSubject.entries()]
      .map(([subject, minutes]) => ({ subject, minutes }))
      .sort((a, b) => b.minutes - a.minutes)
  };
}

export type ReportDraftInput = {
  studentName: string;
  totalMinutes: number;
  topSubject: SubjectCode | null;
  completionRate: number; // 0~1
};

// 결정적 스텁 리포트 초안. 과외쌤이 검토/수정 후 발송한다.
export function getStubReportDraft(input: ReportDraftInput): string {
  const hours = Math.floor(input.totalMinutes / 60);
  const minutes = input.totalMinutes % 60;
  const completion = Math.round(clamp01(input.completionRate) * 100);
  const topSubjectText = input.topSubject ? `${SUBJECT_LABELS[input.topSubject]}에 집중했고` : "여러 과목을 고루 학습했고";
  return (
    `${input.studentName} 학생은 이번 주 총 ${hours}시간 ${minutes}분을 공부했어요. ` +
    `${topSubjectText}, 계획 대비 완료율은 ${completion}%였습니다. ` +
    `꾸준함이 보이는 한 주였어요. (AI 초안 미리보기 — 검토 후 발송)`
  );
}

// 게이팅: 무료=광고 보상 언락 / 프리미엄=무제한 (나의 리포트·AI 추천·혼공 AI 검사).
export type AdUnlockLike = {
  feature: UnlockFeature;
  expires_at: string | null;
};

export type FeatureGateState = {
  feature: UnlockFeature;
  unlocked: boolean;
  isPremium: boolean;
  canUnlockByAd: boolean;
  reason: string;
};

/**
 * 화면에 무엇을 보여줄지 정하는 **안내용** 게이트. 실제 과금 게이트는 서버다
 * (Edge Function + DB 의 has_active_student_premium()). 클라이언트 판정은 우회 가능하다.
 *
 * `subscription` 을 그대로 받는다 — 예전에는 `isPremium: boolean` 을 받았고, 호출부가
 * `status === "active"` 만 넘겨 **expires_at 을 무시**했다(만료된 구독이 계속 프리미엄으로
 * 통과). 불리언을 받으면 그 실수를 막을 수 없으므로 구독 행을 받아 여기서 판정한다.
 */
export function getFeatureGateState(args: {
  feature: UnlockFeature;
  subscription: StudentSubscriptionLike | null | undefined;
  unlocks: AdUnlockLike[];
  now?: string | Date;
}): FeatureGateState {
  const now = toDate(args.now ?? new Date());
  const isPremium = hasActiveStudentPremium(args.subscription, now);
  if (isPremium) {
    return {
      feature: args.feature,
      unlocked: true,
      isPremium: true,
      canUnlockByAd: false,
      reason: "프리미엄: 무제한 이용"
    };
  }

  const hasActiveUnlock = args.unlocks.some(
    (unlock) =>
      unlock.feature === args.feature &&
      (unlock.expires_at === null || new Date(unlock.expires_at).getTime() > now.getTime())
  );

  return {
    feature: args.feature,
    unlocked: hasActiveUnlock,
    isPremium: false,
    canUnlockByAd: !hasActiveUnlock,
    reason: hasActiveUnlock ? "광고 보상으로 언락됨" : "무료: 광고를 보면 한 번 열려요"
  };
}

export function isShareExpired(expiresAt: string | null, now: string | Date = new Date()): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= toDate(now).getTime();
}

export type SharedReportStatus = "ok" | "expired" | "not_found";

export function getSharedReportStatusCopy(status: SharedReportStatus): { title: string; body: string } {
  switch (status) {
    case "ok":
      return { title: "주간 리포트", body: "선생님이 보낸 이번 주 리포트예요." };
    case "expired":
      return { title: "링크가 만료되었어요", body: "선생님께 새 링크를 요청해 주세요." };
    case "not_found":
      return { title: "리포트를 찾을 수 없어요", body: "링크가 올바른지 확인해 주세요." };
  }
}

// AI 추천 → "플래너에 반영": 추천을 본인 할 일(todos) insert 페이로드로 변환.
export function createPlannerTodosFromRecommendation(
  recommendations: StudyRecommendation[],
  studentId: string,
  dueDate: string
): Array<{
  student_id: string;
  title: string;
  subject: SubjectCode;
  source: "self";
  ai_check_enabled: false;
  due_date: string;
  created_by: string;
}> {
  return recommendations.map((rec) => ({
    student_id: studentId,
    title: `${SUBJECT_LABELS[rec.subject]} 주 ${rec.recommendedHours}시간 공부`,
    subject: rec.subject,
    source: "self",
    ai_check_enabled: false,
    due_date: dueDate,
    created_by: studentId
  }));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function toDate(value: string | Date): Date {
  return typeof value === "string" ? new Date(value) : value;
}
