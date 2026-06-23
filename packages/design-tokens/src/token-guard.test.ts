import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { approvedColorValues } from "./index";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const scanRoots = [
  "apps/student/src",
  "apps/student/app",
  "apps/teacher/src/app"
];

function walk(dir: string): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) files.push(full);
  }
  return files;
}

describe("M8 design-token compliance — no arbitrary colors", () => {
  it("every hex color in app screens belongs to the approved palette/tints", () => {
    const approved = new Set(approvedColorValues);
    const offenders: string[] = [];

    for (const root of scanRoots) {
      for (const file of walk(`${repoRoot}${root}`)) {
        const content = readFileSync(file, "utf8");
        const matches = content.match(/#[0-9A-Fa-f]{6}\b/g) ?? [];
        for (const hex of matches) {
          if (!approved.has(hex.toUpperCase())) {
            offenders.push(`${file.replace(repoRoot, "")}: ${hex}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
