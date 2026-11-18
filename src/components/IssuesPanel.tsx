"use client";

/** 실시간 오류 검사 패널: 종류별로 묶어 보여주고, 누르면 해당 칸으로 이동 */
import { useState } from "react";
import { ISSUE_LABEL, type IssueCode } from "@/model/schema";
import type { ValidationIssue } from "./useShowDoc";

interface Props {
  issues: ValidationIssue[];
  /** 저장을 막는 오류가 있는가 */
  blocking: boolean;
  onGo: (issue: ValidationIssue) => void;
}

const ORDER = Object.keys(ISSUE_LABEL) as IssueCode[];

export default function IssuesPanel({ issues, blocking, onGo }: Props) {
  const [open, setOpen] = useState(true);
  const groups = ORDER.map((code) => ({ code, list: issues.filter((i) => (i.code ?? "ref") === code) })).filter((g) => g.list.length);

  if (!issues.length)
    return (
      <p className="mb-3 rounded border border-green-300 bg-green-50 px-3 py-1.5 text-xs text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
        오류 검사: 문제 없음
      </p>
    );

  return (
    <section className="mb-3 rounded border border-red-300 bg-red-50/60 text-xs dark:border-red-900 dark:bg-red-950/40" aria-label="오류 검사">
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-medium text-red-800 dark:text-red-200"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span>{open ? "▾" : "▸"}</span>
        오류 검사 {issues.length}건{blocking ? " — 고치기 전에는 저장되지 않음" : " (저장은 됨)"}
        <span className="ml-2 flex flex-wrap gap-1 font-normal">
          {groups.map((g) => (
            <span key={g.code} className="rounded bg-red-100 px-1.5 dark:bg-red-900/60">
              {ISSUE_LABEL[g.code]} {g.list.length}
            </span>
          ))}
        </span>
      </button>
      {open && (
        <div className="max-h-56 space-y-2 overflow-y-auto border-t border-red-200 px-3 py-2 dark:border-red-900">
          {groups.map((g) => (
            <div key={g.code}>
              <h3 className="mb-0.5 font-semibold text-red-800 dark:text-red-200">
                {ISSUE_LABEL[g.code]} ({g.list.length})
              </h3>
              <ul className="space-y-0.5">
                {g.list.map((i, k) => (
                  <li key={k}>
                    <button className="text-left text-red-900 underline-offset-2 hover:underline dark:text-red-100" onClick={() => onGo(i)} title="눌러서 해당 칸으로 이동">
                      {i.message} →
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
