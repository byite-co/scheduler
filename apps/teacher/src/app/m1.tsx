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

    setMessage("라이브 데이터 동기화 완료");
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
  const monthlyAmount = getTeacherMonthlySubscriptionAmount(activeCount);

  return (
    <TeacherShell
      active="/"
      title="학생 연결을 시작하는 작업대"
      subtitle="초대 코드를 만들고, 요청을 확인하고, 학생이 허용한 공개 범위 안에서만 관리 데이터를 봅니다."
      data={data}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <MetricPanel label="active 연결" value={`${activeCount}명`} />
        <MetricPanel label="이번 달 앱 구독료" value={`${monthlyAmount.toLocaleString("ko-KR")}원`} />
        <MetricPanel
          label="학생당 기준"
          value={`${PRICE_PER_STUDENT_KRW.toLocaleString("ko-KR")}원`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel title="실제 연결 상태">
          <StepList
            steps={[
              ["대기", `${data.connections.filter((c) => c.status === "pending").length}건`],
              ["활성", `${activeCount}건`],
              ["거절", `${data.connections.filter((c) => c.status === "rejected").length}건`],
              ["월 구독료", `${monthlyAmount.toLocaleString("ko-KR")}원`]
            ]}
          />
        </Panel>
        <Panel title="다음 작업">
          <StepList
            steps={[
              ["이메일", data.session ? "로그인됨" : "가입/로그인 필요"],
              ["프로필", data.profile?.onboarded ? "저장 완료" : "프로필 저장 필요"],
              ["초대 코드", data.inviteCodes[0]?.code ? formatInviteCode(data.inviteCodes[0].code) : "미발급"],
              ["요청 처리", "pending 요청을 수락 또는 거절"]
            ]}
          />
        </Panel>
      </div>
    </TeacherShell>
  );
}

export function TeacherLoginContent() {
  const data = useTeacherData();

  return (
    <TeacherShell
      active="/login"
      title="이메일로 로그인"
      subtitle="Supabase Auth 세션으로 로그인하고, 이메일 인증이 필요한 경우 기본 Supabase 메일 링크를 사용합니다."
      data={data}
    >
      <AuthForm mode="login" data={data} />
    </TeacherShell>
  );
}

export function TeacherSignupContent() {
  const data = useTeacherData();

  return (
    <TeacherShell
      active="/signup"
      title="과외쌤 회원가입"
      subtitle="가입 후 이메일 인증을 완료하고 로그인하면 프로필 저장과 초대 코드 발급을 진행할 수 있습니다."
      data={data}
    >
      <AuthForm mode="signup" data={data} />
    </TeacherShell>
  );
}

export function TeacherResetContent() {
  const data = useTeacherData();

  return (
    <TeacherShell
      active="/reset"
      title="비밀번호 재설정"
      subtitle="Supabase Auth 재설정 메일을 보냅니다."
      data={data}
    >
      <ResetPasswordPanel data={data} />
    </TeacherShell>
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
      subtitle="초대 코드를 만든 뒤 학생이 앱에서 입력하면 connections에 pending 요청이 생성됩니다."
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
      subtitle="코드는 invite_codes에 저장되고, 학생의 RPC 요청이 이 코드를 검증해 pending 연결을 만듭니다."
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

function TeacherShell({
  active,
  title,
  subtitle,
  data,
  children
}: {
  active: string;
  title: string;
  subtitle: string;
  data: TeacherData;
  children: ReactNode;
}) {
  async function signOut() {
    await supabase.auth.signOut();
    data.setMessage("로그아웃했습니다.");
    await data.refresh(null);
  }

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
              <p className="text-sm font-extrabold text-brand">M1 라이브 Supabase</p>
              <h1 className="mt-2 text-2xl font-extrabold tracking-normal md:text-4xl">
                {title}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted md:text-base">
                {subtitle}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={data.session ? "success" : "warning"}>
                {data.session ? "로그인됨" : "로그인 필요"}
              </StatusPill>
              {data.session ? (
                <button className="rounded-control border border-line px-3 py-2 text-xs font-extrabold" onClick={signOut}>
                  로그아웃
                </button>
              ) : null}
            </div>
          </header>
          <LiveMessage loading={data.loading} message={data.message} />
          {children}
        </section>
      </div>
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
          : "가입 요청을 보냈습니다. Supabase 기본 인증 메일을 확인해 주세요."
    );
    await data.refresh(result.data.session ?? undefined);
  }

  return (
    <form className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]" onSubmit={submit}>
      <Panel title={mode === "login" ? "계정 로그인" : "계정 만들기"}>
        <Field label="이메일" type="email" value={email} onChange={setEmail} required />
        <Field label="비밀번호" type="password" value={password} onChange={setPassword} required />
        <div className="flex flex-wrap gap-2">
          <SubmitButton>{mode === "login" ? "로그인" : "인증 메일 보내기"}</SubmitButton>
          <SecondaryLink href="/reset">비밀번호 재설정</SecondaryLink>
        </div>
      </Panel>
      <Panel title="Auth 상태">
        <StepList
          steps={[
            ["세션", data.session ? "있음" : "없음"],
            ["이메일", data.session?.user.email ?? "미로그인"],
            ["인증", data.session?.user.email_confirmed_at ? "확인됨" : "메일 확인 필요"]
          ]}
        />
      </Panel>
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
        학생이 이 코드를 입력하면 RPC가 invite_codes를 검증하고 connections에 pending 요청을 만듭니다.
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
