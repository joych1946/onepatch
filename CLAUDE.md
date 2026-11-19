나는 공연 음향 엔지니어이고, 공연 준비용 웹앱을 만들고 있어.

[앱의 목적]
인풋리스트를 "데이터"로 한 번만 입력하면, 크루 배포용 문서(인풋리스트 PDF, 패치 시트,
마이크 집계표, 라벨)와 콘솔 에디터에서 불러올 파일이 모두 자동으로 나오는 앱.

[기술 스택]

- Next.js(App Router) + TypeScript + Tailwind CSS
- 저장: 1차는 브라우저 로컬 저장(IndexedDB) + JSON 파일 내보내기/가져오기. 서버 DB는 공유 기능 단계에서 추가.
- 배포: Vercel
- 유료 서비스나 유료 라이브러리는 쓰지 않는다.

[원칙]

- 모든 화면과 출력물은 하나의 Show 데이터에서 파생된다. 같은 정보를 두 번 입력하게 만들지 않는다.
- 콘솔 기종에 종속되는 로직은 내보내기 모듈에만 둔다. 데이터 모델은 기종 중립으로 유지한다.
- UI 문구는 한국어, 현장 용어는 관용 표기(Aux, Matrix, DCA, 48V, DI)를 그대로 쓴다.
- 입력은 키보드만으로 빠르게 할 수 있어야 한다(스프레드시트 감각).
- 내가 요청한 단계의 범위만 작업하고, 다음 단계 기능은 미리 만들지 않는다.
- 작업이 끝나면 무엇을 만들었는지, 내가 직접 확인할 방법을 짧게 알려준다.

[내 환경]

- 주력 콘솔: Yamaha DM7 Compact (콘솔 펌웨어 V2.0, DM Editor 2.x — 쇼 파일 `.dmxf`)
  · 조사 결과: `docs/research/dm7.md`
- 자주 쓰는 스테이지박스 구성: Rio3224(32in/16out) 1대 + Rio1608(16in/8out) 1대

[개발 메모]

- 데이터 모델의 원천은 `src/model/schema.ts`(zod). 타입은 여기서 z.infer로만 파생한다.
- 검증: `npm test`(vitest), `npm run typecheck`, `npm run lint`, `npm run build`
- Next.js 버전별 주의사항: @AGENTS.md
- 내 라이브러리(보유 장비·소스 목록·추천 마이크)는 Show와 별개로 `src/model/library.ts` 스키마, IndexedDB `library` 저장소에 둔다. Show는 고른 마이크의 사양을 `microphones`에 복사해 JSON 하나로 완결된다.
- 누르기 입력의 계산은 `src/model/pickFlow.ts`(순수 함수), 화면은 `src/components/PickFlow.tsx`. 기본 마이크·소스 목록은 `src/model/libraryDefaults.ts`.
- 아웃풋·DCA·뮤트 표는 공통 키보드 그리드 `src/components/Sheet.tsx`에 열 정의(`src/model/outputColumns.ts`)를 넘겨 쓴다. 버스 이름 프리셋은 `src/model/busPresets.ts`.
- 오류 검사는 `checkShow`(src/model/schema.ts, 종류 코드 `ISSUE_LABEL`) + 보유 수량 `quantityIssues`(src/model/library.ts). 샘플 Show는 경고 0개를 유지한다(테스트로 확인). 패치 계산은 `src/model/patch.ts`.
- 템플릿: 기본 블록·Show 틀과 삽입 계산은 `src/model/templates.ts`, 내 템플릿은 내 라이브러리(`blockTemplates`, `showTemplates`)에 저장.
- 공연 정보 편집: 계산은 `src/model/showInfo.ts`(빈 공연명·잘못된 날짜는 거부), 화면은 `src/components/ShowInfo.tsx`(제목 그 자리 편집 + 공연 정보 대화상자).
- 출력물: 내용은 `src/model/reports.ts`, 인쇄 화면은 `/shows/[id]/print`(`src/components/print`). 쪽 나누기는 행 높이를 재서 직접 한다(미리보기 = 인쇄). 엑셀은 `src/lib/xlsx.ts`(fflate로 직접 작성).
- 콘솔 프로필(기종 고유 값: 이름 글자 수, 채널·버스 수, 컬러·아이콘 목록): `src/export/profile.ts`. 오류 검사의 이름 글자 수도 이 값(`checkShow(show, { nameMax })`). 내보내기 전 점검 `src/export/checks.ts`, 아이콘 `src/export/icons.ts`, 콘솔 할 일 `src/export/dm7/tasks.ts`(인쇄 화면). 기준 쇼 파일은 IndexedDB `consoleFiles`(`src/storage/consoleFileStore.ts`).
- 주소: Show id는 쿼리(`/show?id=`, `/show/print?id=`, `/show/console?id=`, `src/lib/routes.ts`)로 둔다 — 모든 페이지가 정적이라 오프라인용으로 미리 저장된다. 예전 `/shows/[id]`는 next.config의 redirects.
- 오프라인·새 버전: `scripts/sw.template.js` → 빌드 때 `scripts/build-sw.mjs`가 `public/sw.js` 생성(커밋하지 않음), 등록·안내는 `src/components/AppUpdate.tsx`(빌드한 앱에서만). 확인은 `npm run build && npx next start -p 3100`.
- 전체 백업·복원(합치기/덮어쓰기)·백업 알림: `src/model/backup.ts`, `src/storage/backupStore.ts`, 화면 `src/components/DataCare.tsx`(영구 저장 요청·첫 사용 안내 포함).
- 버전: 비교·이름 제안·기준 고르기는 `src/model/versions.ts`(인쇄용 행의 칸으로 비교, id → 번호로 짝짓기), 저장은 `src/storage/versionStore.ts`(IndexedDB `versions` 목록 + `versionData` 내용 — Show 열기는 버전을 읽지 않는다). 화면 `/show/versions`(`src/components/VersionsView.tsx`), 인쇄의 "변경분"·바뀐 행 ▲·머리말 버전 줄. 전체 백업에 포함.
- 콘솔 읽기(DM7 → Show): `src/export/dm7/dm7Import.ts`(파일 → 스냅샷), `src/export/importShow.ts`(새 Show·콘솔 변경분, 기종 중립), 화면 `src/components/Dm7Import.tsx`(목록 "DM7 파일에서 새 Show", 콘솔 화면 6번).
- 콘솔 내보내기(DM7): `src/export/dm7/`. 쇼 파일 위치는 항상 파일 안 스키마로 계산(`mbdf.ts`)하고 코드에 박지 않는다. 검증 샘플은 `~/Documents/vender/dm7`(저장소 밖, 없으면 테스트 건너뜀).
