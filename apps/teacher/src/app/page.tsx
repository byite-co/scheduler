import { colors } from "@ssamplanner/design-tokens";
import {
  PRICE_PER_STUDENT_KRW,
  getTeacherMonthlySubscriptionAmount
} from "@ssamplanner/shared";

const activeStudents = 0;
const monthlyAmount = getTeacherMonthlySubscriptionAmount(activeStudents);

export default function TeacherDashboardPage() {
  return (
    <main className="min-h-screen bg-canvas px-6 py-8 text-ink md:px-10">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold text-brand">과외쌤 앱</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-normal md:text-4xl">
              학생 관리 대시보드
            </h1>
          </div>
          <div className="rounded-control border border-line bg-surface px-4 py-3 text-sm font-semibold text-muted">
            대기 중
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <MetricPanel label="활성 연결" value={`${activeStudents}명`} />
          <MetricPanel
            label="앱 구독료"
            value={`${monthlyAmount.toLocaleString("ko-KR")}원`}
          />
          <MetricPanel label="단가" value={`${PRICE_PER_STUDENT_KRW.toLocaleString("ko-KR")}원`} />
        </div>

        <section className="rounded-card border border-line bg-surface p-6 shadow-[0_16px_40px_rgba(22,26,46,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-extrabold">첫 학생 초대 준비</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                아직 연결된 학생이 없습니다. 첫 학생이 연결되면 숙제, 공부
                기록, 리포트가 이곳에 모입니다.
              </p>
            </div>
            <div
              className="h-12 w-12 rounded-button"
              style={{ backgroundColor: colors.brand }}
              aria-hidden="true"
            />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <BoundaryPanel
            title="앱 구독료"
            body="연결 학생 수에 따라 쌤플래너에 결제되는 비용입니다."
          />
          <BoundaryPanel
            title="수업·수업료"
            body="과외비 기록용 수기 트래커이며 결제 처리를 하지 않습니다."
          />
        </section>
      </section>
    </main>
  );
}

function MetricPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <p className="text-sm font-bold text-muted">{label}</p>
      <p className="mt-3 font-mono text-2xl font-extrabold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

function BoundaryPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <h2 className="text-lg font-extrabold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
    </div>
  );
}
