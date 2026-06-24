"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

import {
  DEFAULT_TEACHER_STUDENT_SETTINGS,
  M1_CONNECTION_STATUS_SCREENS,
  PRICE_PER_STUDENT_KRW,
  formatInviteCode,
  getTeacherMonthlySubscriptionAmount
} from "@ssamplanner/shared";
import type { Database, M1ConnectionStatus } from "@ssamplanner/shared";

type ConnectionRow = Database["public"]["Tables"]["connections"]["Row"];
type DisclosureRow = Database["public"]["Tables"]["disclosure_settings"]["Row"];
type InviteCodeRow = Database["public"]["Tables"]["invite_codes"]["Row"];
type PerStudentSettingsRow = Database["public"]["Tables"]["per_student_settings"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type SubjectCode = Database["public"]["Enums"]["subject_code"];

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

const subjectOptions: Array<{ label: string; value: SubjectCode }> = [
  { label: "수학", value: "math" },
  { label: "영어", value: "english" },
  { label: "국어", value: "korean" },
  { label: "과학", value: "science" },
  { label: "사회", value: "social" },
  { label: "기타", value: "etc" }
];

function useTeacherData() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCodeRow[]>([]);
  const [disclosures, setDisclosures] = useState<DisclosureRow[]>([]);
  const [settings, setSettings] = useState<PerStudentSettingsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("세션 확인 중");

  const refresh = useCallback(async (nextSession?: Session | null) => {
    const activeSession = nextSession ?? (await supabase.auth.getSession()).data.session;
    setSession(activeSession);

    if (!activeSession) {
      setProfile(null);
      setConnections([]);
      setInviteCodes([]);
      setDisclosures([]);
      setSettings([]);
      setMessage("로그인이 필요합니다.");
      setLoading(false);
      return;
    }

    setLoading(true);
    const userId = activeSession.user.id;

    const [profileResult, connectionsResult, inviteResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("connections")
        .select("*")
        .eq("teacher_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("invite_codes")
        .select("*")
        .eq("teacher_id", userId)
        .order("created_at", { ascending: false })
        .limit(5)
    ]);

    if (profileResult.error) setMessage(profileResult.error.message);
    setProfile(profileResult.data);
    setConnections(connectionsResult.data ?? []);
    setInviteCodes(inviteResult.data ?? []);

    const connectionIds = (connectionsResult.data ?? []).map((connection) => connection.id);
    if (connectionIds.length) {
      const [disclosureResult, settingsResult] = await Promise.all([
        supabase.from("disclosure_settings").select("*").in("connection_id", connectionIds),
        supabase.from("per_student_settings").select("*").in("connection_id", connectionIds)
      ]);
      setDisclosures(disclosureResult.data ?? []);
      setSettings(settingsResult.data ?? []);
    } else {
      setDisclosures([]);
      setSettings([]);
    }

    setMessage("");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void refresh(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, [refresh]);

  return {
    session,
    profile,
    connections,
    inviteCodes,
    disclosures,
    settings,
    loading,
    message,
    refresh,
    setMessage
  };
}

type TeacherData = ReturnType<typeof useTeacherData>;

export function TeacherDashboardContent() {
  const data = useTeacherData();
  const activeCount = data.connections.filter((connection) => connection.status === "active").length;
  const pendingCount = data.connections.filter((connection) => connection.status === "pending").length;
  const rejectedCount = data.connections.filter((connection) => connection.status === "rejected").length;
  const monthlyAmount = getTeacherMonthlySubscriptionAmount(activeCount);

  return (
    <TeacherShell
      active="/"
      title="대시보드"
      subtitle="담당 학생 현황과 오늘의 할 일을 한눈에 봅니다."
      data={data}
      actions={
        <a
          href="/students/invite"
          className="rounded-button bg-brand px-4 py-2 text-sm font-extrabold text-white"
        >
          + 학생 초대
        </a>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="담당 학생" value={`${activeCount}명`} hint="active 연결" />
        <StatCard label="대기 요청" value={`${pendingCount}건`} hint="수락 대기" tone={pendingCount ? "warning" : "muted"} />
        <StatCard label="거절" value={`${rejectedCount}건`} hint="최근" />
        <StatCard
          label="이번 달 구독료"
          value={`${monthlyAmount.toLocaleString("ko-KR")}원`}
          hint={`학생당 ${PRICE_PER_STUDENT_KRW.toLocaleString("ko-KR")}원`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="flex flex-col gap-4">
          <Panel title="학생 연결 현황">
            {activeCount ? (
              <ConnectionList data={data} status="active" />
            ) : pendingCount ? (
              <ConnectionList data={data} status="pending" />
            ) : (
              <EmptyState>아직 연결된 학생이 없어요. ‘+ 학생 초대’로 코드를 보내보세요.</EmptyState>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="이번 주 회차 · 수업료">
            <StepList
              steps={[
                ["기록된 회차", "수기 입력"],
                ["수업료", "수기 트래커"]
              ]}
            />
            <p className="text-xs font-bold text-muted">앱 구독료와 수업·수업료는 별개예요.</p>
          </Panel>

          <a href="/homework/review" className="block rounded-card bg-ink p-5 text-white">
            <p className="text-sm font-bold text-white/70">숙제 검사 대기</p>
            <p className="mt-1 text-lg font-extrabold">AI 1차 확인 후 최종 검사</p>
            <span className="mt-3 inline-block rounded-button bg-brand px-4 py-2 text-sm font-extrabold">
              검사하러 가기 →
            </span>
          </a>
        </div>
      </div>
    </TeacherShell>
  );
}

export function TeacherStudentsContent() {
  const data = useTeacherData();
  const pending = data.connections.filter((connection) => connection.status === "pending");

  return (
    <TeacherShell
      active="/students"
      title="학생 관리"
      subtitle="연결된 학생과 들어온 요청을 관리해요."
      data={data}
      actions={
        <a
          href="/students/invite"
          className="rounded-button bg-brand px-4 py-2 text-sm font-extrabold text-white"
        >
          + 학생 초대
        </a>
      }
    >
      {pending.length ? (
        <Panel title={`연결 요청 ${pending.length}건`}>
          <ConnectionList data={data} status="pending" />
        </Panel>
      ) : null}
      <Panel title="연결된 학생">
        <ConnectionList data={data} status="active" />
      </Panel>
      <div className="flex flex-wrap gap-2">
        <a
          href="/students/requests"
          className="rounded-control border border-line bg-surface px-3 py-2 text-sm font-bold text-muted hover:text-ink"
        >
          전체 요청 보기
        </a>
        <a
          href="/students/invite"
          className="rounded-control border border-line bg-surface px-3 py-2 text-sm font-bold text-muted hover:text-ink"
        >
          초대 코드 관리
        </a>
      </div>
    </TeacherShell>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "muted"
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "muted" | "warning";
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-sm font-bold text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold tabular-nums ${tone === "warning" ? "text-warning" : "text-ink"}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs font-bold text-muted">{hint}</p> : null}
    </div>
  );
}

export function TeacherLoginContent() {
  const data = useTeacherData();

  return (
    <TeacherAuthLayout
      title="어떻게 시작할까요?"
      subtitle="이메일로 로그인해요. 인증이 필요하면 메일의 링크를 눌러 주세요."
      data={data}
    >
      <AuthForm mode="login" data={data} />
    </TeacherAuthLayout>
  );
}

export function TeacherSignupContent() {
  const data = useTeacherData();

  return (
    <TeacherAuthLayout
      title="과외쌤 회원가입"
      subtitle="가입 후 이메일 인증을 완료하면 프로필 저장과 학생 초대를 진행할 수 있어요."
      data={data}
    >
      <AuthForm mode="signup" data={data} />
    </TeacherAuthLayout>
  );
}

export function TeacherResetContent() {
  const data = useTeacherData();

  return (
    <TeacherAuthLayout
      title="비밀번호 재설정"
      subtitle="가입한 이메일로 비밀번호 재설정 링크를 보내요."
      data={data}
    >
      <ResetPasswordPanel data={data} />
    </TeacherAuthLayout>
  );
}

export function TeacherProfileContent() {
  const data = useTeacherData();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [subjects, setSubjects] = useState<SubjectCode[]>(["math", "english"]);

  useEffect(() => {
    setName(data.profile?.name ?? "");
    setBio(data.profile?.bio ?? "");
    setSubjects(data.profile?.subjects?.length ? data.profile.subjects : ["math", "english"]);
  }, [data.profile]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data.session) {
      data.setMessage("로그인 후 프로필을 저장할 수 있습니다.");
      return;
    }

    const { error } = await supabase.from("profiles").upsert({
      id: data.session.user.id,
      role: "teacher",
      name,
      bio,
      subjects,
      onboarded: true
    });

    data.setMessage(error ? error.message : "과외쌤 프로필이 저장되었습니다.");
    await data.refresh();
  }

  return (
    <TeacherShell
      active="/onboarding/profile"
      title="과외쌤 프로필"
      subtitle="학생이 초대 요청을 보낼 때 연결될 선생님 계정 정보입니다."
      data={data}
    >
      <form className="grid gap-4 lg:grid-cols-2" onSubmit={saveProfile}>
        <Panel title="기본 정보">
          <Field label="이름" value={name} onChange={setName} required />
          <Field label="소개" value={bio} onChange={setBio} />
          <SubjectPicker selected={subjects} onChange={setSubjects} />
        </Panel>
        <Panel title="저장 상태">
          <StepList
            steps={[
              ["세션", data.session ? "로그인됨" : "로그인 필요"],
              ["역할", data.profile?.role ?? "미저장"],
              ["온보딩", data.profile?.onboarded ? "완료" : "대기"]
            ]}
          />
          <SubmitButton>프로필 저장</SubmitButton>
        </Panel>
      </form>
    </TeacherShell>
  );
}

export function TeacherFirstStudentContent() {
  const data = useTeacherData();

  return (
    <TeacherShell
      active="/onboarding/first-student"
      title="첫 학생 연결"
      subtitle="초대 코드를 만들고 학생에게 알려주세요. 학생이 코드를 입력하면 연결 요청이 도착해요."
      data={data}
    >
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <InviteCodePanel data={data} />
        <Panel title="연결 상태">
          <ConnectionList data={data} status="pending" />
        </Panel>
      </div>
    </TeacherShell>
  );
}

export function TeacherInviteContent() {
  const data = useTeacherData();

  return (
    <TeacherShell
      active="/students/invite"
      title="초대 코드 발급"
      subtitle="발급한 코드를 학생에게 전달하세요. 학생이 입력하면 연결 요청이 만들어져요."
      data={data}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <InviteCodePanel data={data} />
        <Panel title="최근 코드">
          {data.inviteCodes.length ? (
            <StepList
              steps={data.inviteCodes.map((code) => [
                formatInviteCode(code.code),
                code.expires_at ? new Date(code.expires_at).toLocaleString("ko-KR") : "만료 없음"
              ])}
            />
          ) : (
            <EmptyState>아직 발급한 코드가 없습니다.</EmptyState>
          )}
        </Panel>
      </div>
    </TeacherShell>
  );
}

export function TeacherRequestsContent({ status }: { status: M1ConnectionStatus }) {
  const data = useTeacherData();
  const activePath = M1_CONNECTION_STATUS_SCREENS[status].route;

  return (
    <TeacherShell
      active="/students/requests"
      title={M1_CONNECTION_STATUS_SCREENS[status].heading}
      subtitle={M1_CONNECTION_STATUS_SCREENS[status].description}
      data={data}
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
      <Panel title="요청 목록">
        <ConnectionList data={data} status={status} />
      </Panel>
    </TeacherShell>
  );
}

export function TeacherStudentSettingsContent() {
  const data = useTeacherData();

  return (
    <TeacherShell
      active="/students/demo/settings"
      title="학생별 설정"
      subtitle="선생님은 검사 과목과 리포트 주기를 저장하고, 학생 공개 범위는 읽기만 합니다."
      data={data}
    >
      <StudentSettingsPanel data={data} />
    </TeacherShell>
  );
}

const TEACHER_NAV: Array<{ href: string; label: string; icon: string }> = [
  { href: "/", label: "대시보드", icon: "▦" },
  { href: "/students", label: "학생 관리", icon: "👥" },
  { href: "/homework/review", label: "숙제 검사", icon: "✓" },
  { href: "/reports/weekly", label: "리포트", icon: "📄" },
  { href: "/billing", label: "구독·정산", icon: "₩" },
  { href: "/settings", label: "설정", icon: "⚙" }
];

function isNavActive(itemHref: string, active?: string): boolean {
  if (!active) return false;
  if (itemHref === "/") return active === "/";
  return active === itemHref || active.startsWith(`${itemHref}/`) || active.startsWith(itemHref);
}

function TeacherShell({
  active,
  title,
  subtitle,
  data,
  actions,
  children
}: {
  active?: string;
  title: string;
  subtitle: string;
  data: TeacherData;
  actions?: ReactNode;
  children: ReactNode;
}) {
  async function signOut() {
    await supabase.auth.signOut();
    data.setMessage("로그아웃했어요.");
    await data.refresh(null);
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto flex w-full max-w-7xl">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface p-4 md:flex">
          <a href="/" className="mb-6 flex items-center gap-2 px-2 text-lg font-extrabold text-brand">
            쌤플래너
          </a>
          <nav className="flex flex-1 flex-col gap-1">
            {TEACHER_NAV.map((item) => {
              const activeItem = isNavActive(item.href, active);
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-control px-3 py-2 text-sm font-bold ${
                    activeItem ? "bg-canvas text-brand" : "text-muted hover:bg-canvas hover:text-ink"
                  }`}
                >
                  <span className="w-5 text-center">{item.icon}</span>
                  {item.label}
                </a>
              );
            })}
          </nav>
          <div className="mt-4 rounded-control border border-line p-3">
            <p className="text-sm font-extrabold text-ink">{data.profile?.name ?? "과외쌤"}</p>
            <p className="text-xs font-bold text-muted">{data.session ? "선생님 계정" : "로그인 필요"}</p>
            {data.session ? (
              <button className="mt-2 text-xs font-extrabold text-muted hover:text-ink" onClick={signOut}>
                로그아웃
              </button>
            ) : null}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-5 px-4 py-6 md:px-8">
          <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-extrabold tracking-normal md:text-3xl">{title}</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{subtitle}</p>
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </header>
          <LiveMessage loading={data.loading} message={data.message} />
          {children}
        </section>
      </div>
    </main>
  );
}

function TeacherAuthLayout({
  title,
  subtitle,
  data,
  children
}: {
  title: string;
  subtitle: string;
  data: TeacherData;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-surface text-ink md:grid md:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-brand p-10 text-white md:flex">
        <div className="text-lg font-extrabold">쌤플래너</div>
        <div>
          <h2 className="text-3xl font-extrabold leading-snug">
            계획부터 인증까지,
            <br />
            입시 공부를 한 곳에서.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-6 text-white/80">
            과외 선생님은 숙제·AI 완료검사·학부모 리포트를, 학생은 타이머·플래너·집중 모드를 따로 또 같이.
          </p>
        </div>
        <div className="flex gap-10">
          <div>
            <div className="text-2xl font-extrabold">1.2만+</div>
            <div className="text-xs font-bold text-white/70">함께 공부하는 학생</div>
          </div>
          <div>
            <div className="text-2xl font-extrabold">94%</div>
            <div className="text-xs font-bold text-white/70">숙제 이행률</div>
          </div>
        </div>
      </aside>

      <section className="flex min-h-screen flex-col justify-center gap-5 px-6 py-10 md:px-16">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-2xl font-extrabold">{title}</h1>
          <p className="mt-1 text-sm leading-6 text-muted">{subtitle}</p>
          <div className="mt-5">
            <LiveMessage loading={data.loading} message={data.message} />
          </div>
          <div className="mt-3">{children}</div>
        </div>
      </section>
    </main>
  );
}

function AuthForm({ mode, data }: { mode: "login" | "signup"; data: TeacherData }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/login` }
          });

    data.setMessage(
      result.error
        ? result.error.message
        : mode === "login"
          ? "로그인했습니다."
          : "가입 요청을 보냈어요. 인증 메일을 확인해 주세요."
    );
    await data.refresh(result.data.session ?? undefined);
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <Field label="이메일" type="email" value={email} onChange={setEmail} required />
      <Field label="비밀번호" type="password" value={password} onChange={setPassword} required />
      <SubmitButton>{mode === "login" ? "로그인" : "인증 메일 보내기"}</SubmitButton>
      <div className="flex items-center justify-between text-sm">
        <a href={mode === "login" ? "/signup" : "/login"} className="font-bold text-muted hover:text-ink">
          {mode === "login" ? "처음이신가요? 회원가입" : "이미 계정이 있나요? 로그인"}
        </a>
        <a href="/reset" className="font-bold text-brand">
          비밀번호 재설정
        </a>
      </div>
    </form>
  );
}

function ResetPasswordPanel({ data }: { data: TeacherData }) {
  const [email, setEmail] = useState("");

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset`
    });
    data.setMessage(error ? error.message : "비밀번호 재설정 메일을 보냈습니다.");
  }

  return (
    <form onSubmit={reset}>
      <Panel title="재설정 메일">
        <Field label="이메일" type="email" value={email} onChange={setEmail} required />
        <SubmitButton>재설정 메일 보내기</SubmitButton>
      </Panel>
    </form>
  );
}

function InviteCodePanel({ data }: { data: TeacherData }) {
  const latest = data.inviteCodes[0];

  async function createInvite() {
    if (!data.session) {
      data.setMessage("로그인 후 초대 코드를 발급할 수 있습니다.");
      return;
    }
    if (data.profile?.role !== "teacher") {
      data.setMessage("과외쌤 프로필을 먼저 저장해 주세요.");
      return;
    }

    const code = createInviteCode();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("invite_codes").insert({
      code,
      teacher_id: data.session.user.id,
      expires_at: expiresAt
    });

    data.setMessage(error ? error.message : `${formatInviteCode(code)} 초대 코드를 발급했습니다.`);
    await data.refresh();
  }

  return (
    <Panel title="초대 코드">
      <div className="rounded-control border border-line bg-canvas px-4 py-5 font-mono text-3xl font-extrabold tracking-normal text-ink tabular-nums">
        {latest ? formatInviteCode(latest.code) : "------"}
      </div>
      <p className="text-sm leading-6 text-muted">
        학생이 이 코드를 입력하면 연결 요청이 도착해요. 요청을 수락하면 연결이 시작돼요.
      </p>
      <button
        className="inline-flex min-h-11 items-center justify-center rounded-button bg-brand px-4 py-2 text-sm font-extrabold text-white"
        onClick={createInvite}
        type="button"
      >
        새 코드 발급
      </button>
    </Panel>
  );
}

function ConnectionList({ data, status }: { data: TeacherData; status: M1ConnectionStatus }) {
  const rows = data.connections.filter((connection) => connection.status === status);

  async function decide(connection: ConnectionRow, decision: "accept" | "reject") {
    const patch =
      decision === "accept"
        ? { status: "active" as const, activated_at: new Date().toISOString() }
        : { status: "rejected" as const, activated_at: null };
    const { error } = await supabase.from("connections").update(patch).eq("id", connection.id);

    if (!error && decision === "accept") {
      await supabase.from("per_student_settings").upsert({
        connection_id: connection.id,
        ai_check_subjects: DEFAULT_TEACHER_STUDENT_SETTINGS.aiCheckSubjects as SubjectCode[],
        report_cycle: DEFAULT_TEACHER_STUDENT_SETTINGS.reportCycle
      });
    }

    data.setMessage(error ? error.message : decision === "accept" ? "연결을 수락했습니다." : "연결을 거절했습니다.");
    await data.refresh();
  }

  if (!rows.length) {
    return <EmptyState>{M1_CONNECTION_STATUS_SCREENS[status].label} 상태의 연결이 없습니다.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((connection) => (
        <div key={connection.id} className="rounded-control border border-line bg-canvas p-4">
          <StepList
            steps={[
              ["학생 ID", shortId(connection.student_id)],
              ["초대 코드", connection.invite_code ? formatInviteCode(connection.invite_code) : "-"],
              ["상태", connection.status]
            ]}
          />
          {connection.status === "pending" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-button bg-brand px-4 py-2 text-sm font-extrabold text-white" onClick={() => void decide(connection, "accept")}>
                수락
              </button>
              <button className="rounded-button border border-line px-4 py-2 text-sm font-extrabold" onClick={() => void decide(connection, "reject")}>
                거절
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function StudentSettingsPanel({ data }: { data: TeacherData }) {
  const activeConnections = data.connections.filter((connection) => connection.status === "active");
  const [selectedId, setSelectedId] = useState("");
  const selected = activeConnections.find((connection) => connection.id === selectedId) ?? activeConnections[0];
  const setting = data.settings.find((row) => row.connection_id === selected?.id);
  const disclosure = data.disclosures.find((row) => row.connection_id === selected?.id);
  const [reportCycle, setReportCycle] = useState<"weekly" | "biweekly" | "none">("weekly");
  const [subjects, setSubjects] = useState<SubjectCode[]>(["math"]);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    setReportCycle((setting?.report_cycle as "weekly" | "biweekly" | "none" | undefined) ?? "weekly");
    setSubjects(setting?.ai_check_subjects?.length ? setting.ai_check_subjects : ["math"]);
  }, [selected, selectedId, setting]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    const { error } = await supabase.from("per_student_settings").upsert({
      connection_id: selected.id,
      ai_check_subjects: subjects,
      report_cycle: reportCycle
    });

    data.setMessage(error ? error.message : "학생별 설정을 저장했습니다.");
    await data.refresh();
  }

  if (!activeConnections.length) {
    return <Panel title="학생별 설정"><EmptyState>active 연결 학생이 없습니다.</EmptyState></Panel>;
  }

  return (
    <form className="grid gap-4 lg:grid-cols-2" onSubmit={saveSettings}>
      <Panel title="선생님 설정">
        <label className="flex flex-col gap-2 text-sm font-bold text-muted">
          학생 연결
          <select className="h-11 rounded-control border border-line bg-canvas px-3 text-sm font-semibold text-ink" value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
            {activeConnections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {shortId(connection.student_id)}
              </option>
            ))}
          </select>
        </label>
        <SubjectPicker selected={subjects} onChange={setSubjects} />
        <label className="flex flex-col gap-2 text-sm font-bold text-muted">
          리포트 주기
          <select className="h-11 rounded-control border border-line bg-canvas px-3 text-sm font-semibold text-ink" value={reportCycle} onChange={(event) => setReportCycle(event.target.value as "weekly" | "biweekly" | "none")}>
            <option value="weekly">매주</option>
            <option value="biweekly">격주</option>
            <option value="none">사용 안 함</option>
          </select>
        </label>
        <SubmitButton>설정 저장</SubmitButton>
      </Panel>
      <Panel title="학생 공개 범위">
        <DisclosureRow label="공부 시간·과목" enabled={Boolean(disclosure?.share_study_time)} />
        <DisclosureRow label="숙제·검사 사진" enabled={Boolean(disclosure?.share_homework_photos)} />
        <DisclosureRow label="집중도·졸음 데이터" enabled={Boolean(disclosure?.share_focus_data)} />
        <p className="text-sm leading-6 text-muted">이 값은 학생 앱에서만 수정할 수 있습니다.</p>
      </Panel>
    </form>
  );
}

function SubjectPicker({ selected, onChange }: { selected: SubjectCode[]; onChange: (subjects: SubjectCode[]) => void }) {
  function toggle(subject: SubjectCode) {
    onChange(selected.includes(subject) ? selected.filter((value) => value !== subject) : [...selected, subject]);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold text-muted">과목</span>
      <div className="flex flex-wrap gap-2">
        {subjectOptions.map((subject) => (
          <button
            className={`rounded-chip px-3 py-2 text-sm font-extrabold ${selected.includes(subject.value) ? "bg-brand text-white" : "border border-line text-ink"}`}
            key={subject.value}
            onClick={() => toggle(subject.value)}
            type="button"
          >
            {subject.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LiveMessage({ loading, message }: { loading: boolean; message: string }) {
  if (!loading && !message) return null;
  return (
    <div className="rounded-control border border-line bg-surface px-4 py-3 text-sm font-bold text-muted">
      {loading ? "불러오는 중..." : message}
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

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-bold text-muted">
      {label}
      <input
        className="h-11 rounded-control border border-line bg-canvas px-3 text-sm font-semibold text-ink outline-none"
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}

function SubmitButton({ children }: { children: ReactNode }) {
  return (
    <button className="inline-flex min-h-11 items-center justify-center rounded-button bg-brand px-4 py-2 text-sm font-extrabold text-white" type="submit">
      {children}
    </button>
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

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-muted">{children}</p>;
}

function createInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}...`;
}
