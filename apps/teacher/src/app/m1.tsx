"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import {
  ChevronRight,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  Settings,
  Users,
  Wallet,
  type LucideIcon
} from "lucide-react";

import {
  CONSENT_DOCUMENTS,
  CONSENT_DOCUMENT_LABELS,
  CONSENT_DOCUMENT_VERSION,
  CONSENT_PENDING_NOTICE,
  M1_CONNECTION_STATUS_SCREENS,
  formatInviteCode,
  buildConsentRows,
  canProceedWithConsent,
  consentDocumentsForRpc,
  formatPendingRequestLabel,
  indexPendingRequests
} from "@ssamplanner/shared";
import type { ConsentSelection, Database, M1ConnectionStatus, PendingConnectionRequest } from "@ssamplanner/shared";

import { supabase } from "./supabaseClient";

type ConnectionRow = Database["public"]["Tables"]["connections"]["Row"];
type DisclosureRow = Database["public"]["Tables"]["disclosure_settings"]["Row"];
type InviteCodeRow = Database["public"]["Tables"]["invite_codes"]["Row"];
type PerStudentSettingsRow = Database["public"]["Tables"]["per_student_settings"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type SubjectCode = Database["public"]["Enums"]["subject_code"];

// 이메일 인증이 필요한 설정에서는 가입 직후 세션이 없어 동의를 기록할 수 없다(RLS 가 본인
// 행만 허용한다). 체크 상태를 잠시 보관하고 **온보딩 프로필 저장 시점**에 기록한다.
// localStorage 를 쓰는 이유: 인증 메일 링크를 누르면 새 탭·새 로드가 되므로 메모리로는 유실된다.
const TEACHER_CONSENT_KEY = "ssamplanner.teacherConsent";

function writeTeacherConsent(selection: ConsentSelection): void {
  try {
    localStorage.setItem(TEACHER_CONSENT_KEY, JSON.stringify(selection));
  } catch {
    // 저장 실패는 치명적이지 않다 — 프로필 화면에서 다시 받을 수 있다.
  }
}

function readTeacherConsent(): ConsentSelection {
  try {
    const raw = localStorage.getItem(TEACHER_CONSENT_KEY);
    return raw ? (JSON.parse(raw) as ConsentSelection) : {};
  } catch {
    return {};
  }
}

function clearTeacherConsent(): void {
  try {
    localStorage.removeItem(TEACHER_CONSENT_KEY);
  } catch {
    // 무시.
  }
}

// 로그인/가입 후 갈 곳을 온보딩 상태로 결정.
async function resolveTeacherRoute(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return "/login";
  const profile = await supabase.from("profiles").select("onboarded").eq("id", userId).maybeSingle();
  return profile.data?.onboarded ? "/" : "/onboarding/profile";
}

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

// 온보딩(프로필 저장) 미완료 과외쌤을 프로필 작성 화면으로 보낸다.
// 세션이 있는데 profiles.onboarded=false면 대시보드/초대 등 보호 화면을 막고
// /onboarding/profile로 유도한다(세션 자체 가드는 TeacherShell이 담당).
// 호출처는 실제 profile을 읽는(useTeacherData 전체를 쓰는) 화면이어야 한다.
// 온보딩 화면(/onboarding/*)에서는 호출하지 않는다 — 루프 방지.
function useRequireOnboarding(data: TeacherData) {
  const router = useRouter();
  useEffect(() => {
    if (data.loading || !data.session) return;
    if (!data.profile?.onboarded) {
      router.replace("/onboarding/profile");
    }
  }, [data.loading, data.session, data.profile?.onboarded, router]);
}

type DashboardStudent = { id: string; name: string; minutes: number };

// active 연결 학생의 이름. RLS(profiles_connected_read)가 active 만 허용하므로 여기 담기는 건
// 전부 과외쌤이 볼 수 있는 이름이다. 학생을 고르는 화면은 전부 이걸 쓴다 —
// 이름을 안 붙이면 UUID 앞자리가 그대로 노출되고 누가 누군지 구분할 수 없다.
function useActiveStudentNames(connections: ConnectionRow[]): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const idKey = connections
    .filter((c) => c.status === "active")
    .map((c) => c.student_id)
    .join(",");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const ids = idKey ? idKey.split(",") : [];
      if (!ids.length) {
        if (!cancelled) setNames(new Map());
        return;
      }
      const { data } = await supabase.from("profiles").select("id, name").in("id", ids);
      if (cancelled) return;
      setNames(new Map((data ?? []).map((p) => [p.id, (p.name ?? "").trim()])));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [idKey]);

  return names;
}

// 이름이 비어 있을 때만 식별자 일부를 폴백으로. 빈 칸으로 두면 행이 깨진 것처럼 보인다.
function studentLabel(names: Map<string, string>, studentId: string): string {
  return names.get(studentId) || `학생 ${shortId(studentId)}`;
}

function useDashboardStudents(connections: ConnectionRow[]): DashboardStudent[] {
  const [students, setStudents] = useState<DashboardStudent[]>([]);
  const names = useActiveStudentNames(connections);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const ids = connections.filter((c) => c.status === "active").map((c) => c.student_id);
      if (!ids.length) {
        if (!cancelled) setStudents([]);
        return;
      }
      const weekStart = new Date();
      weekStart.setUTCHours(0, 0, 0, 0);
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      const since = `${weekStart.toISOString().slice(0, 10)}T00:00:00.000Z`;

      // 공개범위 게이팅 뷰(v_teacher_study_sessions)만 읽는다 — RLS/데이터 무변경.
      // 이름은 useActiveStudentNames 가 이미 가져온다(같은 조회를 두 번 하지 않는다).
      const sessionsRes = await supabase
        .from("v_teacher_study_sessions")
        .select("student_id, duration_sec, started_at")
        .in("student_id", ids)
        .gte("started_at", since);
      if (cancelled) return;

      const minutesById = new Map<string, number>();
      for (const row of sessionsRes.data ?? []) {
        const sid = row.student_id;
        if (!sid) continue;
        const minutes = Math.round(Math.max(0, row.duration_sec ?? 0) / 60);
        minutesById.set(sid, (minutesById.get(sid) ?? 0) + minutes);
      }

      setStudents(
        ids
          .map((id) => ({
            id,
            name: studentLabel(names, id),
            minutes: minutesById.get(id) ?? 0
          }))
          .sort((a, b) => a.minutes - b.minutes)
      );
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [connections, names]);

  return students;
}

// pending 요청의 학생 이름은 profiles 를 직접 못 읽는다(RLS 가 active 만 허용).
// 전용 RPC 가 이름·학년만 돌려준다. 목록 화면이므로 인자 없이 한 번만 부른다(N+1 회피).
function usePendingRequestNames(connections: ConnectionRow[]): Map<string, PendingConnectionRequest> {
  const [byId, setById] = useState<Map<string, PendingConnectionRequest>>(new Map());
  const pendingKey = connections
    .filter((c) => c.status === "pending")
    .map((c) => c.id)
    .join(",");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!pendingKey) {
        if (!cancelled) setById(new Map());
        return;
      }
      const { data } = await supabase.rpc("pending_connection_requests");
      if (cancelled) return;
      // 실패하면 빈 Map — 이름 없이라도 목록은 그려야 한다(수락/거절 자체를 막지 않는다).
      setById(indexPendingRequests(data as PendingConnectionRequest[] | null));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [pendingKey]);

  return byId;
}

// 집중 관리 상태: 신규·무데이터 학생은 '주의'로 깃발하지 않는다(기록 없음=중립).
// 이번 주 공부시간 기준(0=기록 없음, <60분=주의, 그 이상=양호).
function focusStatus(minutes: number): { label: string; className: string } {
  if (minutes <= 0) return { label: "기록 없음", className: "bg-canvas text-muted" };
  if (minutes < 60) return { label: "주의", className: "bg-warning/10 text-[#7A5700]" };
  return { label: "양호", className: "bg-success/10 text-success" };
}

function formatStudyMinutes(minutes: number): string {
  if (minutes <= 0) return "이번 주 기록 없음";
  return `이번 주 ${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

function StudentAvatar({ name }: { name: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-chip bg-brand/10 text-sm font-extrabold text-brand">
      {name.slice(0, 1)}
    </span>
  );
}

function StudentRow({ student }: { student: DashboardStudent }) {
  const status = focusStatus(student.minutes);
  return (
    <a
      href={`/students/${student.id}`}
      className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface px-4 py-3 transition-colors hover:border-brand hover:bg-canvas"
    >
      <span className="flex min-w-0 items-center gap-3">
        <StudentAvatar name={student.name} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-extrabold text-ink">{student.name}</span>
          <span className="text-xs font-bold text-muted">{formatStudyMinutes(student.minutes)}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className={`whitespace-nowrap rounded-chip px-2.5 py-1 text-xs font-extrabold ${status.className}`}>
          {status.label}
        </span>
        <ChevronRight className="h-4 w-4 text-muted" strokeWidth={2} />
      </span>
    </a>
  );
}

function StudentFocusTable({ students }: { students: DashboardStudent[] }) {
  // '집중 관리가 필요한 학생'은 실제로 기록이 있고 저조한 학생만(기록 없음·양호 제외).
  const needsAttention = students.filter((student) => student.minutes > 0 && student.minutes < 60);
  if (!needsAttention.length) return null;
  return (
    <Panel title="집중 관리가 필요한 학생">
      <div className="flex flex-col gap-2">
        {needsAttention.slice(0, 6).map((student) => (
          <StudentRow key={student.id} student={student} />
        ))}
      </div>
    </Panel>
  );
}

export function TeacherDashboardContent() {
  const data = useTeacherData();
  useRequireOnboarding(data);
  const pendingCount = data.connections.filter((connection) => connection.status === "pending").length;
  const rejectedCount = data.connections.filter((connection) => connection.status === "rejected").length;
  const activeCount = data.connections.filter((connection) => connection.status === "active").length;
  const dashStudents = useDashboardStudents(data.connections);

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
        {/*
          "이번 달 구독료 / 학생당 4,900원" 카드를 지웠다. 가격이 확정되지 않았고 결제 수단도
          없다 — 확정 전 금액을 대시보드 첫 화면에 숫자로 박아 두면 사용자는 그걸 확정가로 읽는다.
          대체 문구를 넣지 않는다(제거만 한다).
        */}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="flex flex-col gap-4">
          <StudentFocusTable students={dashStudents} />
          <Panel title="학생 연결 현황">
            {activeCount ? (
              <div className="flex flex-col gap-2">
                {dashStudents.map((student) => (
                  <StudentRow key={student.id} student={student} />
                ))}
              </div>
            ) : pendingCount ? (
              <ConnectionList data={data} status="pending" />
            ) : (
              <EmptyStatePanel
                icon={<Users className="h-6 w-6 text-brand" strokeWidth={2} />}
                title="아직 연결된 학생이 없어요"
                body="‘+ 학생 초대’로 코드를 보내면 학생이 입력해 연결돼요."
                ctaHref="/students/invite"
                ctaLabel="학생 초대하기"
              />
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
  useRequireOnboarding(data);
  const pending = data.connections.filter((connection) => connection.status === "pending");
  const roster = useDashboardStudents(data.connections);
  const activeCount = data.connections.filter((connection) => connection.status === "active").length;

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
      <Panel title={`연결된 학생${activeCount ? ` ${activeCount}명` : ""}`}>
        {activeCount ? (
          <div className="flex flex-col gap-2">
            {roster.map((student) => (
              <StudentRow key={student.id} student={student} />
            ))}
          </div>
        ) : (
          <EmptyStatePanel
            icon={<Users className="h-6 w-6 text-brand" strokeWidth={2} />}
            title="아직 연결된 학생이 없어요"
            body="‘+ 학생 초대’로 코드를 보내면 학생이 입력해 연결돼요."
            ctaHref="/students/invite"
            ctaLabel="학생 초대하기"
          />
        )}
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
  const router = useRouter();
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

    // 🚨 **onboarded 는 여기서 켜지 않는다.** 예전에는 onboarded=true 를 먼저 저장하고 동의를
    //    나중에 넣었는데, 그 insert 의 error 를 읽지도 않아서 동의 증적 없이 온보딩이 끝난
    //    계정이 조용히 생길 수 있었다. 지금은 프로필 필드만 저장하고, 동의 기록과 onboarded 를
    //    RPC 하나가 한 트랜잭션으로 처리한다.
    const { error } = await supabase.from("profiles").upsert({
      id: data.session.user.id,
      role: "teacher",
      name,
      bio,
      subjects
    });

    if (error) {
      data.setMessage(error.message);
      return;
    }

    // 가입 때 세션이 없어 기록하지 못한 동의를 여기서 넘긴다(이메일 인증 경로).
    // 비어 있어도 그대로 넘긴다 — 가입 시점에 이미 기록됐는지는 **서버가** 확인한다.
    // 여기서 "아마 동의했을 것" 으로 목록을 채우면 동의하지 않은 계정의 증적을 만들어 낸다.
    const stashed = readTeacherConsent();
    const finished = await supabase.rpc("finish_onboarding_with_consent", {
      p_documents: consentDocumentsForRpc(stashed),
      p_version: CONSENT_DOCUMENT_VERSION,
      p_method: "teacher_web_onboarding"
    });
    if (finished.error) {
      data.setMessage(`동의 기록에 실패해서 온보딩을 마치지 못했어요: ${finished.error.message}`);
      return;
    }
    clearTeacherConsent();

    await data.refresh();
    // 프로필 저장 완료 → 대시보드로.
    router.replace("/");
  }

  return (
    <TeacherShell
      active="/onboarding/profile"
      title="과외쌤 프로필"
      subtitle="학생이 초대 요청을 보낼 때 연결될 선생님 계정 정보입니다."
      data={data}
    >
      <form className="grid gap-4" onSubmit={saveProfile}>
        <Panel title="기본 정보">
          <Field label="이름" value={name} onChange={setName} required />
          <Field label="소개" value={bio} onChange={setBio} />
          <SubjectPicker selected={subjects} onChange={setSubjects} />
          <SubmitButton>프로필 저장</SubmitButton>
        </Panel>
      </form>
    </TeacherShell>
  );
}

export function TeacherSettingsContent() {
  const data = useTeacherData();
  useRequireOnboarding(data);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [subjects, setSubjects] = useState<SubjectCode[]>(["math", "english"]);

  useEffect(() => {
    setName(data.profile?.name ?? "");
    setBio(data.profile?.bio ?? "");
    setSubjects(data.profile?.subjects?.length ? data.profile.subjects : ["math", "english"]);
  }, [data.profile]);


  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data.session) {
      data.setMessage("로그인 후 설정을 저장할 수 있습니다.");
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
    if (error) {
      data.setMessage(error.message);
      return;
    }
    await data.refresh();
    data.setMessage("설정을 저장했어요.");
  }

  return (
    <TeacherShell active="/settings" title="설정" subtitle="검사 대상·브랜딩·결제를 관리합니다." data={data}>
      <form className="grid gap-4" onSubmit={saveSettings}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="AI 완료검사 대상">
            <p className="text-sm font-bold text-muted">담당 과목별 검사·리포트에 포함돼요.</p>
            <SubjectPicker selected={subjects} onChange={setSubjects} />
          </Panel>
          <Panel title="브랜딩">
            <p className="text-sm font-bold text-muted">리포트·공유 링크에 표시돼요.</p>
            <Field label="표시 이름" value={name} onChange={setName} required />
            <Field label="소개" value={bio} onChange={setBio} />
          </Panel>
        </div>
        <div>
          <SubmitButton>설정 저장</SubmitButton>
        </div>
      </form>

      <div className="mt-4">
        <Panel title="구독 · 정산">
          <div className="flex flex-wrap items-end justify-between gap-3">
            {/*
              금액("이번 달 앱 구독료 · N원 · 학생당 4,900원")을 지웠다. 가격 미확정 + 결제 미연동
              상태에서 숫자를 보여 주면 확정가로 읽힌다. 연동 학생 수는 대시보드 상단 카드에
              이미 있어 여기서 다시 말하지 않는다.
            */}
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-muted">앱 구독</p>
            </div>
            <a
              href="/billing"
              className="inline-flex min-h-11 items-center justify-center rounded-button bg-brand px-4 py-2 text-sm font-extrabold text-white"
            >
              결제 관리
            </a>
          </div>
          <p className="text-xs font-bold text-muted">앱 구독료와 수업·수업료는 별개예요.</p>
        </Panel>
      </div>

      {/*
        🚨 알림 센터와 회원 탈퇴로 가는 **유일한** 진입점이다. 지우지 마라.
        두 화면 모두 구현은 끝나 있었지만 링크가 0건이라 URL 직접 입력으로만 열렸다.
        회원 탈퇴 도달 불가는 AGENTS.md 절대 규칙 위반이자 심사 리젝 사유다.
        (/notifications 는 이미 TeacherShell 에 active="/settings" 로 들어온다 — 즉
         설정 하위로 설계돼 있었는데 링크만 없던 것이다.)
      */}
      <div className="mt-4">
        <Panel title="계정">
          <a
            href="/notifications"
            className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-line bg-surface px-4 py-3 transition-colors hover:border-brand hover:bg-canvas"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-extrabold text-ink">알림 센터</span>
              <span className="text-xs font-bold text-muted">숙제·검사·연동 알림을 모아 봐요.</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
          </a>
          <a
            href="/settings/account/delete"
            className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-line bg-surface px-4 py-3 transition-colors hover:border-danger hover:bg-canvas"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-extrabold text-danger">회원 탈퇴</span>
              <span className="text-xs font-bold text-muted">계정과 데이터가 모두 삭제돼요.</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
          </a>
        </Panel>
      </div>
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
  useRequireOnboarding(data);

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
  useRequireOnboarding(data);
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
  useRequireOnboarding(data);

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

const TEACHER_NAV: Array<{ href: string; label: string; short: string; icon: LucideIcon }> = [
  { href: "/", label: "대시보드", short: "홈", icon: LayoutDashboard },
  { href: "/students", label: "학생 관리", short: "학생", icon: Users },
  { href: "/homework/review", label: "숙제 검사", short: "검사", icon: ClipboardCheck },
  { href: "/reports/weekly", label: "리포트", short: "리포트", icon: FileText },
  { href: "/billing", label: "구독·정산", short: "정산", icon: Wallet },
  { href: "/settings", label: "설정", short: "설정", icon: Settings }
];

function isNavActive(itemHref: string, active?: string): boolean {
  if (!active) return false;
  if (itemHref === "/") return active === "/";
  return active === itemHref || active.startsWith(`${itemHref}/`) || active.startsWith(itemHref);
}

export type TeacherShellData = {
  session: Session | null;
  loading: boolean;
  message: string;
  profile?: { name?: string | null } | null;
  setMessage: (message: string) => void;
  refresh: (next?: Session | null) => Promise<void>;
};

export function TeacherShell({
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
  data: TeacherShellData;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();

  // 보호 화면: 로딩 끝났는데 세션이 없으면 로그인으로 보낸다(인증 화면은 TeacherShell을 쓰지 않으므로 루프 없음).
  useEffect(() => {
    if (!data.loading && !data.session) {
      router.replace("/login");
    }
  }, [data.loading, data.session, router]);

  async function signOut() {
    await supabase.auth.signOut();
    data.setMessage("로그아웃했어요.");
    await data.refresh(null);
    router.replace("/login");
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
              const Icon = item.icon;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-control px-3 py-2 text-sm font-bold ${
                    activeItem ? "bg-canvas text-brand" : "text-muted hover:bg-canvas hover:text-ink"
                  }`}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
                  {item.label}
                </a>
              );
            })}
          </nav>
          {/* 좌하단 Next dev 인디케이터(원형)와 겹치지 않도록 카드를 띄우고 로그아웃을 우측 정렬. */}
          <div className="mb-14 mt-4 flex items-center justify-between gap-2 rounded-control border border-line p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold text-ink">{data.profile?.name ?? "과외쌤"}</p>
              <p className="text-xs font-bold text-muted">{data.session ? "선생님 계정" : "로그인 필요"}</p>
            </div>
            {data.session ? (
              <button className="shrink-0 rounded-control px-2 py-1 text-xs font-extrabold text-muted hover:bg-canvas hover:text-ink" onClick={signOut}>
                로그아웃
              </button>
            ) : null}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-5 px-4 pb-24 pt-6 md:px-8 md:pb-6">
          <a href="/" className="text-base font-extrabold text-brand md:hidden">
            쌤플래너
          </a>
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

      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface md:hidden">
        {TEACHER_NAV.map((item) => {
          const activeItem = isNavActive(item.href, active);
          const Icon = item.icon;
          return (
            <a
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-bold ${
                activeItem ? "text-brand" : "text-muted"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              {item.short}
            </a>
          );
        })}
      </nav>
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

/**
 * 가입 동의 체크 골격. **문안은 준비 중이라 본문·링크가 없다.**
 * 지금 하는 일은 두 가지뿐이다: 필수 동의를 받고, 그 사실을 기록할 수 있게 하는 것.
 */
function ConsentChecklist({
  selection,
  onChange
}: {
  selection: ConsentSelection;
  onChange: (next: ConsentSelection) => void;
}) {
  return (
    <fieldset className="grid gap-2 rounded-control border border-line bg-canvas p-4">
      <legend className="px-1 text-xs font-extrabold text-muted">약관 동의</legend>
      {CONSENT_DOCUMENTS.map((doc) => (
        <label key={doc} className="flex items-center gap-2 text-sm font-bold text-ink">
          <input
            type="checkbox"
            checked={selection[doc] === true}
            onChange={(event) => onChange({ ...selection, [doc]: event.target.checked })}
          />
          {CONSENT_DOCUMENT_LABELS[doc]}
        </label>
      ))}
      <p className="text-xs font-bold text-muted">{CONSENT_PENDING_NOTICE}</p>
    </fieldset>
  );
}

function AuthForm({ mode, data }: { mode: "login" | "signup"; data: TeacherData }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // 🚨 과외쌤 웹 가입에는 동의 절차가 **아예 없었다**(A0 §A4). 학생 앱에는 있는데 과외쌤은
  //    이메일·비밀번호만 받고 계정이 생겼다 — 학생의 개인정보를 다루는 쪽이라 더 필요하다.
  const [consent, setConsent] = useState<ConsentSelection>({});
  const consentOk = canProceedWithConsent(consent);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 버튼도 잠겨 있지만 여기서 한 번 더 막는다(폼은 Enter 로도 제출된다).
    if (mode === "signup" && !consentOk) {
      data.setMessage("필수 약관에 동의해 주세요.");
      return;
    }
    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/login` }
          });

    if (result.error) {
      data.setMessage(result.error.message);
      return;
    }
    await data.refresh(result.data.session ?? undefined);

    if (mode === "signup") {
      if (result.data.session) {
        // 동의 증적을 남긴다. RLS 가 본인 행만 허용하므로 **세션이 있어야** 기록할 수 있다.
        // 실패하면 조용히 넘기지 않는다 — 체크 상태를 남겨 두어 온보딩에서 다시 기록하게 하고
        // (거기서 onboarded 와 한 트랜잭션으로 묶인다), 사용자에게도 알린다.
        const rows = buildConsentRows(result.data.session.user.id, consent, "teacher_web_signup");
        const recorded = rows.length ? await supabase.from("consent_records").insert(rows) : { error: null };
        if (recorded.error) {
          writeTeacherConsent(consent);
          data.setMessage(`동의 기록이 지연됐어요(온보딩에서 다시 시도해요): ${recorded.error.message}`);
        }
        // 가입 즉시 로그인됨 → 온보딩(프로필)으로.
        router.replace("/onboarding/profile");
      } else {
        // 이메일 인증이 필요한 설정에서는 아직 세션이 없어 **지금은 기록할 수 없다.**
        // 체크 상태를 남겨 두고 온보딩(프로필 저장) 시점에 기록한다.
        // ⚠️ mailer_autoconfirm 을 끄면(출시 전 필수) 이 경로가 기본이 된다.
        writeTeacherConsent(consent);
        data.setMessage("가입 요청을 보냈어요. 인증 메일의 링크를 누른 뒤 로그인해 주세요.");
      }
      return;
    }
    // 로그인: 온보딩 완료면 대시보드, 아니면 프로필.
    router.replace(await resolveTeacherRoute());
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <Field label="이메일" type="email" value={email} onChange={setEmail} required />
      <Field label="비밀번호" type="password" value={password} onChange={setPassword} required />
      {mode === "signup" ? <ConsentChecklist selection={consent} onChange={setConsent} /> : null}
      <SubmitButton disabled={mode === "signup" && !consentOk}>
        {mode === "login" ? "로그인" : "인증 메일 보내기"}
      </SubmitButton>
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
  const pendingNames = usePendingRequestNames(data.connections);

  async function decide(connection: ConnectionRow, decision: "accept" | "reject") {
    // 수락은 쓰기가 둘이다(설정 행 생성 + 상태 전이). 클라이언트에서 순차로 하면 사이에서
    // 끊길 때 "설정 없는 active" 가 남고, 예전 코드는 두 번째 쓰기의 error 를 읽지도 않아
    // 실패해도 "수락했습니다" 가 떴다. RPC 한 번으로 묶어 둘 다 되거나 둘 다 안 되게 한다.
    // 거절은 쓰기가 하나뿐이라 그대로 UPDATE 한다.
    const { error } =
      decision === "accept"
        ? await supabase.rpc("accept_connection_request", { p_connection_id: connection.id })
        : await supabase
            .from("connections")
            .update({ status: "rejected" as const, activated_at: null })
            .eq("id", connection.id);

    data.setMessage(error ? error.message : decision === "accept" ? "연결을 수락했습니다." : "연결을 거절했습니다.");
    await data.refresh();
  }

  if (!rows.length) {
    return <EmptyState>{M1_CONNECTION_STATUS_SCREENS[status].label} 상태의 연결이 없습니다.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((connection) => {
        // pending 일 때만 이름이 온다. 아직 안 왔거나 실패했으면 기존대로 식별자를 보여 준다
        // (누구인지 모르는 채 누르게 두더라도, 목록이 사라지는 것보다는 낫다).
        const request = pendingNames.get(connection.id);
        return (
        <div key={connection.id} className="rounded-control border border-line bg-canvas p-4">
          <StepList
            steps={[
              request
                ? ["학생", formatPendingRequestLabel(request)]
                : ["학생 ID", shortId(connection.student_id)],
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
        );
      })}
    </div>
  );
}

function StudentSettingsPanel({ data }: { data: TeacherData }) {
  const activeConnections = data.connections.filter((connection) => connection.status === "active");
  const studentNames = useActiveStudentNames(data.connections);
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
                {studentLabel(studentNames, connection.student_id)}
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

function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button
      className="inline-flex min-h-11 items-center justify-center rounded-button bg-brand px-4 py-2 text-sm font-extrabold text-white disabled:opacity-50"
      disabled={disabled}
      type="submit"
    >
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

// 카탈로그 빈 상태 패턴: 아이콘 + 안내문 + 단일 CTA.
export function EmptyStatePanel({
  icon,
  title,
  body,
  ctaHref,
  ctaLabel
}: {
  icon: ReactNode;
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-control border border-dashed border-line bg-canvas px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-card bg-brand/10">{icon}</span>
      <p className="text-base font-extrabold text-ink">{title}</p>
      <p className="max-w-sm text-sm font-bold leading-6 text-muted">{body}</p>
      {ctaHref && ctaLabel ? (
        <a
          href={ctaHref}
          className="mt-1 inline-flex min-h-10 items-center justify-center rounded-button bg-brand px-4 py-2 text-sm font-extrabold text-white"
        >
          {ctaLabel}
        </a>
      ) : null}
    </div>
  );
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
