/**
 * 최소한의 엑셀(xlsx) 작성기. xlsx는 XML 파일 몇 개를 zip으로 묶은 것이므로
 * 무거운 라이브러리 없이 직접 만든다 (압축만 fflate).
 * 지원: 시트 여러 개, 머리글 굵게·회색, 틀 고정, 자동 필터, 열 너비, 행 색(컬러 표시), 숫자/문자 셀.
 */
import { strToU8, zipSync } from "fflate";

export type XCell = string | number | null | undefined;

export interface XSheet {
  name: string;
  /** 표 위에 넣는 제목 줄들 (공연 정보 등) */
  title?: string[];
  columns: { label: string; width?: number }[];
  rows: XCell[][];
  /** 행별 채우기 색 (16진수 "RRGGBB", 없으면 null) — 첫 열에만 칠한다 */
  rowFill?: (string | null)[];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** 시트 이름: 31자, 금지 문자 제거, 중복 피하기 */
function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    const base = (n.replace(/[\\/?*[\]:]/g, " ").trim() || "Sheet").slice(0, 31);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function buildXlsx(sheets: XSheet[]): Uint8Array {
  // 채우기 색 모음 → 스타일 인덱스
  const fills = [...new Set(sheets.flatMap((s) => (s.rowFill ?? []).filter((x): x is string => !!x)))];
  // cellXfs: 0 기본, 1 머리글, 2 제목, 3.. 색 칸
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="13"/><name val="Arial"/></font></fonts>
<fills count="${3 + fills.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E5E5"/></patternFill></fill>${fills
    .map((f) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${f}"/></patternFill></fill>`)
    .join("")}</fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom></border></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="${4 + fills.length}"><xf/><xf fontId="0" borderId="1" applyBorder="1"/><xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/><xf fontId="2" applyFont="1"/>${fills
    .map((_, i) => `<xf fontId="1" fillId="${3 + i}" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>`)
    .join("")}</cellXfs>
</styleSheet>`;
  const S_CELL = 1;
  const S_HEAD = 2;
  const S_TITLE = 3;
  const sFill = (hex: string) => 4 + fills.indexOf(hex);

  const names = sheetNames(sheets.map((s) => s.name));
  const files: Record<string, Uint8Array> = {};

  sheets.forEach((sh, si) => {
    const out: string[] = [];
    let r = 0;
    const cell = (c: number, v: XCell, style: number) => {
      const ref = `${colName(c)}${r + 1}`;
      if (v === null || v === undefined || v === "") return `<c r="${ref}" s="${style}"/>`;
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
    };
    for (const t of sh.title ?? []) {
      out.push(`<row r="${r + 1}">${cell(0, t, S_TITLE)}</row>`);
      r++;
    }
    if (sh.title?.length) r++; // 빈 줄
    const headRow = r;
    out.push(`<row r="${r + 1}">${sh.columns.map((c, i) => cell(i, c.label, S_HEAD)).join("")}</row>`);
    r++;
    sh.rows.forEach((row, k) => {
      const fill = sh.rowFill?.[k];
      out.push(`<row r="${r + 1}">${sh.columns.map((_, i) => cell(i, row[i], i === 0 && fill ? sFill(fill) : S_CELL)).join("")}</row>`);
      r++;
    });
    const last = `${colName(sh.columns.length - 1)}${Math.max(r, headRow + 1)}`;
    const cols = sh.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 12}" customWidth="1"/>`).join("");
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow + 1}" topLeftCell="A${headRow + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${out.join("")}</sheetData>
<autoFilter ref="A${headRow + 1}:${last}"/>
<pageSetup paperSize="9" orientation="landscape"/>
</worksheet>`,
    );
  });

  files["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`);
  files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files["xl/workbook.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
${sheets.some((s) => s.rows.length) ? `<definedNames>${sheets
    .map((s, i) => {
      const head = (s.title?.length ? s.title.length + 1 : 0) + 1;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i]).replace(/'/g, "''")}'!$A$${head}:$${colName(s.columns.length - 1)}$${Math.max(head, head + s.rows.length)}</definedName>`;
    })
    .join("")}</definedNames>` : ""}
</workbook>`);
  files["xl/_rels/workbook.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files["xl/styles.xml"] = strToU8(styles);
  return zipSync(files, { level: 6 });
}
