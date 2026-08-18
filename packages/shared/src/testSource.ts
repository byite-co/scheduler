/**
 * 소스 파일을 문자열로 단정하는 테스트를 위한 도우미.
 *
 * 왜 필요했나 — CI 가 빨갛고 로컬이 초록이던 실제 사고에서 나왔다.
 *
 *   1) **줄바꿈**: 저장소 blob 은 LF 로 저장되지만 Windows 워킹트리는 CRLF 로 체크아웃된다
 *      (Git for Windows 의 system `core.autocrlf=true`). 그래서 앵커에 `\n` 을 쓰면
 *      로컬에서는 `indexOf` 가 **-1** 을 돌려준다.
 *   2) **-1 의 함정**: `slice(start, -1)` 은 오류가 아니라 "끝에서 한 글자 뺀 문자열" 이다.
 *      즉 앵커를 못 찾으면 창이 **파일 거의 전체**로 벌어져, 무엇을 단정하든 통과한다(거짓 초록).
 *   3) **앵커 중복**: 끝 앵커를 파일 처음부터 찾으면 시작 앵커보다 **앞선** 등장에 걸릴 수 있다.
 *      그러면 `end < start` 라 slice 가 **빈 문자열**이 되고, 이번엔 무엇을 단정하든 실패한다.
 *
 * 그래서 이 모듈은 (a) 읽을 때 줄바꿈을 정규화하고 (b) 끝 앵커를 시작 이후에서만 찾고
 * (c) 앵커를 못 찾으면 **던진다**. 못 찾은 것이 조용히 통과나 실패로 바뀌지 않게 한다.
 */
import { readFileSync } from "node:fs";

/** 줄바꿈을 LF 로 정규화해 읽는다 — 단정이 체크아웃 방식에 흔들리지 않게. */
export function readSource(url: URL): string {
  return readFileSync(url, "utf8").replace(/\r\n/g, "\n");
}

/** 이미 읽은 문자열의 줄바꿈만 정규화한다. */
export function normalizeEol(source: string): string {
  return source.replace(/\r\n/g, "\n");
}

/**
 * `startAnchor` 부터 그 **뒤에 나오는** `endAnchor` 까지를 잘라낸다.
 * 둘 중 하나라도 없으면 던진다(조용한 거짓 초록/거짓 실패 방지).
 */
export function sliceBetween(source: string, startAnchor: string, endAnchor: string): string {
  const text = normalizeEol(source);
  const start = text.indexOf(startAnchor);
  if (start < 0) throw new Error(`시작 앵커를 찾지 못했다: ${JSON.stringify(startAnchor)}`);
  const end = text.indexOf(endAnchor, start + startAnchor.length);
  if (end < 0) throw new Error(`시작 이후에서 끝 앵커를 찾지 못했다: ${JSON.stringify(endAnchor)}`);
  return text.slice(start, end);
}

/** 줄 주석(`//`, `--`)을 걷어낸다 — 주석 산문에 단정이 걸리는 것을 막는다. */
export function codeOnly(source: string): string {
  return normalizeEol(source)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("--");
    })
    .join("\n");
}

/**
 * `startAnchor` 부터 `length` 글자를 잘라낸다(끝 앵커가 마땅치 않은 고정 창).
 * 시작 앵커가 없으면 던진다 — `indexOf` 가 -1 을 돌려주면 `slice(-1, ...)` 이 되어
 * 창이 조용히 빈 문자열이나 꼬리 한 글자로 바뀐다.
 */
export function sliceFrom(source: string, startAnchor: string, length: number): string {
  const text = normalizeEol(source);
  const start = text.indexOf(startAnchor);
  if (start < 0) throw new Error(`시작 앵커를 찾지 못했다: ${JSON.stringify(startAnchor)}`);
  return text.slice(start, start + length);
}
