import type { Database } from "./database.types";

export type SubjectCode = Database["public"]["Enums"]["subject_code"];

export const SUBJECT_LABELS: Record<SubjectCode, string> = {
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
  social: "사회",
  etc: "기타"
};
