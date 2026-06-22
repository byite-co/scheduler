import type { ReactNode } from "react";

import {
  DEFAULT_DISCLOSURE_SCOPE,
  M1_CONNECTION_STATUS_SCREENS,
  PRICE_PER_STUDENT_KRW,
  formatInviteCode,
  getTeacherMonthlySubscriptionAmount,
  getTeacherVisibleStudentSections
} from "@ssamplanner/shared";
import type { M1ConnectionStatus } from "@ssamplanner/shared";

type TeacherShellProps = {
  active: string;
  title: string;
  subtitle: string;
  children: ReactNode;
};

const navItems = [
  { href: "/", label: "대시보드" },
  { href: "/login", label: "로그인" },
  { href: "/signup", label: "회원가입" },
  { href: "/onboarding/profile", label: "프로필" },
  { href: "/onboarding/first-student", label: "첫 학생" },
  { href: "/students/invite", label: "초대 코드" },
  { href: "/students/requests", label: "연결 요청" },
  { href: "/students/demo/settings", label: "학생별 설정" }
];

const sampleInviteCode = "SSAM24";
const activeStudents = 1;
const monthlyAmount = getTeacherMonthlySubscriptionAmount(activeStudents);
const visibleSections = getTeacherVisibleStudentSections({
  ...DEFAULT_DISCLOSURE_SCOPE,
  shareHomeworkPhotos: false
});

export function TeacherShell({ active, title, subtitle, children }: TeacherShellProps) {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-5 md:grid-cols-[220px_1fr] md:px-8">
        <aside className="rounded-card border border-line bg-surface p-4">
          <a href="/" className="block text-lg font-extrabold text-brand">
            쌤플래너
          </a>
          <nav className="mt-6 flex flex-row gap-2 overflow-x-auto md:flex-col md:overflow-visible">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-control px-3 py-2 text-sm font-bold ${
                  active === item.href
                    ? "bg-brand text-white"
                    : "text-muted hover:bg-canvas hover:text-ink"
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-col gap-5">
          <header className="flex flex-col gap-3 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-extrabold text-brand">M1 인증 · 온보딩 · 연결</p>
              <h1 className="mt-2 text-2xl font-extrabold tracking-normal md:text-4xl">
                {title}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted md:text-base">
                {subtitle}
              </p>
            </div>
            <StatusPill tone="success">스키마 연결됨</StatusPill>
          </header>
          {children}
        </section>
      </div>
    </main>
  );
}

export function TeacherDashboardContent() {
  return (
    <TeacherShell
      active="/"
      title="학생 연결을 시작하는 작업대"
      subtitle="초대 코드를 만들고, 요청을 확인하고, 학생이 허용한 공개 범위 안에서만 관리 데이터를 봅니다."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <MetricPanel label="active 연결" value={`${activeStudents}명`} />
        <MetricPanel label="이번 달 앱 구독료" value={`${monthlyAmount.toLocaleString("ko-KR")}원`} />
        <MetricPanel
          label="학생당 기준"
          value={`${PRICE_PER_STUDENT_KRW.toLocaleString("ko-KR")}원`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel title="다음 작업">
          <StepList
            steps={[
              ["이메일 인증", "가입 메일 확인 후 로그인 가능"],
              ["프로필 입력", "과목, 소개, 운영 방식을 저장"],
              ["초대 코드 발급", `${formatInviteCode(sampleInviteCode)} 코드로 학생 연결 요청`],
              ["요청 수락", "pending 요청을 active로 전환"]
            ]}
          />
        </Panel>
        <Panel title="공개 범위">
          <DisclosureSummary />
        </Panel>
      </div>
    </TeacherShell>
  );
}

export function TeacherLoginContent() {
  return (
    <TeacherShell
      active="/login"
      title="이메일로 로그인"
      subtitle="이메일 인증이 끝난 계정으로 들어오고, 비밀번호 재설정은 메일 링크로 처리합니다."
    >
      <AuthForm mode="login" />
    </TeacherShell>
  );
}

export function TeacherSignupContent() {
  return (
    <TeacherShell
      active="/signup"
      title="과외쌤 회원가입"
      subtitle="가입 직후 이메일 인증을 보내고, 인증 완료 뒤 첫 프로필 온보딩으로 이동합니다."
    >
      <AuthForm mode="signup" />
    </TeacherShell>
  );
}

export function TeacherResetContent() {
  return (
    <TeacherShell
      active="/reset"
      title="비밀번호 재설정"
      subtitle="Supabase Auth 재설정 메일을 보내는 화면입니다."
    >
      <Panel title="재설정 메일">
        <Field label="이메일" value="teacher@example.com" />
        <PrimaryLink href="/login">재설정 메일 보내기</PrimaryLink>
      </Panel>
    </TeacherShell>
  );
}

export function TeacherProfileContent() {
  return (
    <TeacherShell
      active="/onboarding/profile"
      title="과외쌤 프로필"
      subtitle="학생이 연결 요청을 확인할 때 보게 되는 기본 정보입니다."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="기본 정보">
          <Field label="이름" value="김선생" />
          <Field label="전문 과목" value="수학, 영어" />
          <Field label="소개" value="주간 숙제 점검과 입시 공부량 관리를 함께 운영합니다." />
        </Panel>
        <Panel title="인증 상태">
          <StepList
            steps={[
              ["이메일", "인증 완료"],
              ["프로필", "저장 대기"],
              ["첫 학생", "초대 코드 발급 전"]
            ]}
          />
          <PrimaryLink href="/onboarding/first-student">프로필 저장</PrimaryLink>
        </Panel>
      </div>
    </TeacherShell>
  );
}

export function TeacherFirstStudentContent() {
  return (
    <TeacherShell
      active="/onboarding/first-student"
      title="첫 학생 연결"
      subtitle="초대 코드를 만든 뒤 학생이 앱에서 입력하면 pending 요청으로 들어옵니다."
    >
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <InviteCodePanel />
        <Panel title="연결 상태 분기">
          <ConnectionStatusPanel status="pending" />
        </Panel>
      </div>
    </TeacherShell>
  );
}

export function TeacherInviteContent() {
  return (
    <TeacherShell
      active="/students/invite"
      title="초대 코드 발급"
      subtitle="코드는 선생님 계정에 묶이고, 학생이 입력하면 연결 요청이 생성됩니다."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <InviteCodePanel />
        <Panel title="코드 관리">
          <StepList
            steps={[
              ["만료", "48시간 뒤 재발급"],
              ["사용", "한 학생이 요청하면 코드에 기록"],
              ["중복", "같은 학생과 선생님은 하나의 연결만 유지"]
            ]}
          />
        </Panel>
      </div>
    </TeacherShell>
  );
}

export function TeacherRequestsContent({ status }: { status: M1ConnectionStatus }) {
  const activePath = M1_CONNECTION_STATUS_SCREENS[status].route;

  return (
    <TeacherShell
      active="/students/requests"
      title={M1_CONNECTION_STATUS_SCREENS[status].heading}
      subtitle={M1_CONNECTION_STATUS_SCREENS[status].description}
    >
      <div className="flex flex-wrap gap-2">
        {Object.entries(M1_CONNECTION_STATUS_SCREENS).map(([key, screen]) => (
          <a
            key={key}
            href={screen.route}
            className={`rounded-control px-3 py-2 text-sm font-bold ${
              activePath === screen.route
                ? "bg-brand text-white"
                : "border border-line bg-surface text-muted"
            }`}
          >
            {screen.label}
          </a>
        ))}
      </div>
      <Panel title="요청 상세">
        <ConnectionStatusPanel status={status} />
      </Panel>
    </TeacherShell>
  );
}

export function TeacherStudentSettingsContent() {
  return (
    <TeacherShell
      active="/students/demo/settings"
      title="학생별 설정"
      subtitle="선생님은 검사 과목과 리포트 주기를 정하고, 학생 공개 범위는 읽기만 합니다."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="선생님 설정">
          <StepList
            steps={[
              ["AI 검사 과목", "수학, 영어"],
              ["리포트 주기", "매주"],
              ["숙제 잠금", "선생님 숙제는 학생이 AI 검사 여부를 바꿀 수 없음"]
            ]}
          />
        </Panel>
        <Panel title="학생 공개 범위">
          <DisclosureSummary />
        </Panel>
      </div>
    </TeacherShell>
  );
}

function AuthForm({ mode }: { mode: "login" | "signup" }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <Panel title={mode === "login" ? "계정 로그인" : "계정 만들기"}>
        <Field label="이메일" value="teacher@example.com" />
        <Field label="비밀번호" value="••••••••" />
        <div className="flex flex-wrap gap-2">
          <PrimaryLink href={mode === "login" ? "/" : "/onboarding/profile"}>
            {mode === "login" ? "로그인" : "인증 메일 보내기"}
          </PrimaryLink>
          <SecondaryLink href="/reset">비밀번호 재설정</SecondaryLink>
        </div>
      </Panel>
      <Panel title="Auth 체크">
        <StepList
          steps={[
            ["가입", "Supabase Auth email signUp"],
            ["인증", "이메일 링크 확인"],
            ["재설정", "reset password email"]
          ]}
        />
      </Panel>
    </div>
  );
}

function InviteCodePanel() {
  return (
    <Panel title="초대 코드">
      <div className="rounded-control border border-line bg-canvas px-4 py-5 font-mono text-3xl font-extrabold tracking-normal text-ink tabular-nums">
        {formatInviteCode(sampleInviteCode)}
      </div>
      <p className="text-sm leading-6 text-muted">
        학생 앱의 연결 화면에서 이 코드를 입력하면 요청 상태가 pending으로 생성됩니다.
      </p>
      <PrimaryLink href="/students/requests">요청 확인</PrimaryLink>
    </Panel>
  );
}

function ConnectionStatusPanel({ status }: { status: M1ConnectionStatus }) {
  const screen = M1_CONNECTION_STATUS_SCREENS[status];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-extrabold">{screen.heading}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">{screen.description}</p>
        </div>
        <StatusPill tone={screen.tone}>{screen.label}</StatusPill>
      </div>
      <StepList
        steps={
          status === "pending"
            ? [
                ["학생", "김학생 · 중2"],
                ["요청 코드", formatInviteCode(sampleInviteCode)],
                ["선생님 액션", "수락 또는 거절"]
              ]
            : status === "active"
              ? [
                  ["학생", "김학생 · 중2"],
                  ["연결", "active"],
                  ["공개 범위", visibleSections.join(", ")]
                ]
              : [
                  ["학생", "김학생 · 중2"],
                  ["연결", "rejected"],
                  ["데이터 접근", "차단"]
                ]
        }
      />
      <div className="flex flex-wrap gap-2">
        {status === "pending" ? (
          <>
            <PrimaryLink href="/students/requests/accepted">수락</PrimaryLink>
            <SecondaryLink href="/students/requests/rejected">거절</SecondaryLink>
          </>
        ) : (
          <SecondaryLink href="/students/requests">요청 목록</SecondaryLink>
        )}
      </div>
    </div>
  );
}

function DisclosureSummary() {
  return (
    <div className="flex flex-col gap-3">
      <DisclosureRow label="공부 시간·과목" enabled />
      <DisclosureRow label="숙제·검사 사진" enabled={false} />
      <DisclosureRow label="집중도·졸음 데이터" enabled={false} />
      <p className="text-sm leading-6 text-muted">
        선생님 화면은 학생이 켠 항목만 표시하고, 공개 범위 값은 학생만 바꿀 수 있습니다.
      </p>
    </div>
  );
}

function DisclosureRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line pb-3 last:border-b-0 last:pb-0">
      <span className="text-sm font-bold text-ink">{label}</span>
      <StatusPill tone={enabled ? "success" : "warning"}>{enabled ? "공개" : "숨김"}</StatusPill>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-[0_16px_40px_rgba(22,26,46,0.08)]">
      <h2 className="text-lg font-extrabold">{title}</h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function MetricPanel({ label, value }: { label: string; value: string }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <p className="text-sm font-bold text-muted">{label}</p>
      <p className="mt-3 font-mono text-2xl font-extrabold tabular-nums text-ink">{value}</p>
    </section>
  );
}

function StepList({ steps }: { steps: Array<[string, string]> }) {
  return (
    <div className="flex flex-col gap-3">
      {steps.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-4 border-b border-line pb-3 last:border-b-0 last:pb-0">
          <span className="text-sm font-bold text-muted">{label}</span>
          <span className="max-w-[70%] text-right text-sm font-semibold leading-6 text-ink">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-bold text-muted">
      {label}
      <input
        className="h-11 rounded-control border border-line bg-canvas px-3 text-sm font-semibold text-ink outline-none"
        defaultValue={value}
      />
    </label>
  );
}

function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center justify-center rounded-button bg-brand px-4 py-2 text-sm font-extrabold text-white"
    >
      {children}
    </a>
  );
}

function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center justify-center rounded-button border border-line bg-surface px-4 py-2 text-sm font-extrabold text-ink"
    >
      {children}
    </a>
  );
}

function StatusPill({
  tone,
  children
}: {
  tone: "success" | "warning" | "danger";
  children: ReactNode;
}) {
  const toneClass = {
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-[#7A5700]",
    danger: "bg-danger/10 text-danger"
  }[tone];

  return (
    <span className={`whitespace-nowrap rounded-chip px-3 py-1 text-xs font-extrabold ${toneClass}`}>
      {children}
    </span>
  );
}
