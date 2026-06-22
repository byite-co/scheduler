import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "쌤플래너 과외쌤",
  description: "과외쌤을 위한 학생 공부관리 도구"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
