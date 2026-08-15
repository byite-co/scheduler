import type { Metadata, Viewport } from "next";

// 공유 링크는 **공개 URL** 이다. 로그인 없이 열리는 대신 지켜야 할 것이 둘 있다.
//
//   1) 검색엔진에 실리면 안 된다.
//      학부모가 링크를 어딘가(블로그·게시판·메신저 미리보기)에 남기면 크롤러가 따라온다.
//      한 번 색인되면 토큰을 몰라도 검색으로 학생 리포트에 도달한다 — 만료 정책이 무의미해진다.
//      noindex/nofollow/noarchive 로 색인·캐시를 모두 막는다.
//
//   2) Referer 로 토큰이 새면 안 된다.
//      이 화면에서 외부로 나가는 링크가 생기면 그 요청의 Referer 헤더에 **토큰이 통째로** 실려
//      제3자 서버 로그에 남는다. 지금은 외부 링크가 없지만, 나중에 하나만 추가돼도 새기 시작한다.
//      no-referrer 로 원천 차단한다.
export const metadata: Metadata = {
  title: "학습 리포트 · 쌤플래너",
  description: "선생님이 보내드린 학습 리포트예요.",
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  referrer: "no-referrer"
};

// 학부모는 대부분 카톡에서 바로 열어 본다 — 모바일 폭에 맞춰 시작한다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1
};

export default function SharedReportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
