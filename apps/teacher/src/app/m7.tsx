"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

import { NOTIF_TYPE_LABELS, unreadCount, validateDeleteConfirmation, type NotifType } from "@ssamplanner/shared";
import type { Database } from "@ssamplanner/shared";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

export function TeacherNotificationCenter() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("세션 확인 중");

  const refresh = useCallback(async () => {
    setLoading(true);
    const active = (await supabase.auth.getSession()).data.session;
    if (!active) {
      setMessage("로그인이 필요합니다.");
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", active.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setNotifications(data ?? []);
    setMessage(error?.message ?? "알림을 불러왔습니다.");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function markRead(id: string) {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    await refresh();
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-1 border-b border-line pb-5">
          <p className="text-sm font-extrabold text-brand">알림 센터</p>
          <h1 className="text-2xl font-extrabold">알림 {unreadCount(notifications) > 0 ? `· 안 읽음 ${unreadCount(notifications)}` : ""}</h1>
          <p className="text-sm font-bold text-muted" aria-live="polite">{loading ? "불러오는 중…" : message}</p>
        </header>
        {!loading && notifications.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-6 text-sm font-bold text-muted">아직 알림이 없습니다.</div>
        ) : null}
        {notifications.map((notification) => (
          <button
            key={notification.id}
            className={`flex items-center gap-3 rounded-control border px-4 py-3 text-left ${notification.read ? "border-line bg-surface" : "border-brand bg-brand/5"}`}
            onClick={() => void markRead(notification.id)}
            type="button"
          >
            <span className="text-xs font-extrabold text-brand">{NOTIF_TYPE_LABELS[notification.type as NotifType]}</span>
            <span className="flex-1">
              <span className="block text-sm font-bold">{notification.title}</span>
              {notification.body ? <span className="block text-sm font-semibold text-muted">{notification.body}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}

export function TeacherAccountDelete() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canDelete = validateDeleteConfirmation(confirm);

  async function deleteAccount() {
    if (!canDelete) return;
    setBusy(true);
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 text-ink">
      <div className="grid w-full max-w-md gap-3 rounded-card border border-danger bg-surface p-6">
        <h1 className="text-xl font-extrabold">회원 탈퇴</h1>
        <p className="text-sm font-bold text-muted">
          탈퇴하면 담당 학생 연결, 리포트, 구독 정보가 영구 삭제되고 복구할 수 없습니다. 확인을 위해 ‘삭제’를 입력하세요.
        </p>
        <input className="rounded-control border border-line px-3 py-2 text-sm" onChange={(e) => setConfirm(e.target.value)} placeholder="삭제" value={confirm} />
        {message ? <p className="text-sm font-bold text-danger">{message}</p> : null}
        <button
          className="rounded-control bg-danger px-4 py-2 text-sm font-bold text-surface disabled:opacity-50"
          disabled={!canDelete || busy}
          onClick={() => void deleteAccount()}
          type="button"
        >
          {busy ? "삭제 중…" : "영구 삭제하기"}
        </button>
      </div>
    </main>
  );
}
