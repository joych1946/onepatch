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

- 주력 콘솔: Yamaha CL5 (1단계에서 기본값으로 가정, 확정 필요 시 수정)
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
- 출력물: 내용은 `src/model/reports.ts`, 인쇄 화면은 `/shows/[id]/print`(`src/components/print`). 쪽 나누기는 행 높이를 재서 직접 한다(미리보기 = 인쇄). 엑셀은 `src/lib/xlsx.ts`(fflate로 직접 작성).
