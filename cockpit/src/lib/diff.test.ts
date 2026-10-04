import { describe, expect, it } from "vitest";
import { diffTexts } from "./diff";

const sign = (kind: string) => (kind === "add" ? "+" : kind === "del" ? "-" : " ");
const render = (d: ReturnType<typeof diffTexts>) => d.hunks.map((h) => h.lines.map((l) => `${sign(l.kind)}${l.text}`));

describe("diffTexts", () => {
  it("shows a new file as all additions", () => {
    const d = diffTexts(undefined, "a\nb\n");
    expect(d).toMatchObject({ additions: 2, deletions: 0, newOnly: false });
    expect(d.hunks[0].lines).toEqual([
      { kind: "add", text: "a", newNo: 1 },
      { kind: "add", text: "b", newNo: 2 },
    ]);
  });

  it("finds added, removed and changed lines with numbers", () => {
    const d = diffTexts("one\ntwo\nthree\n", "one\n2\nthree\nfour\n");
    expect(d).toMatchObject({ additions: 2, deletions: 1 });
    expect(render(d)).toEqual([[" one", "-two", "+2", " three", "+four"]]);
    expect(d.hunks[0].lines[2]).toEqual({ kind: "add", text: "2", newNo: 2 });
    expect(d.hunks[0].lines[3]).toEqual({ kind: "ctx", text: "three", oldNo: 3, newNo: 3 });
  });

  it("keeps three lines of context and splits distant changes into hunks", () => {
    const old = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
    const next = [...old];
    next[1] = "changed 2";
    next[17] = "changed 18";
    const d = diffTexts(`${old.join("\n")}\n`, `${next.join("\n")}\n`);
    expect(d.hunks).toHaveLength(2);
    expect(render(d)[0]).toEqual([" l1", "-l2", "+changed 2", " l3", " l4", " l5"]);
    expect(d.hunks[1].header).toBe("line 15");
  });

  it("reports no hunks for identical texts", () => {
    expect(diffTexts("same\n", "same\n")).toMatchObject({ additions: 0, deletions: 0, hunks: [] });
  });

  it("treats a missing trailing newline like any other line ending", () => {
    expect(render(diffTexts("a\nb", "a\nb\nc"))).toEqual([[" a", " b", "+c"]]);
  });

  it("falls back to the new text when the change is too large to diff", () => {
    const big = (p: string) => Array.from({ length: 2500 }, (_, i) => `${p}${i}`).join("\n");
    const d = diffTexts(big("a"), big("b"));
    expect(d.newOnly).toBe(true);
    expect(d.additions).toBe(2500);
  });
});
