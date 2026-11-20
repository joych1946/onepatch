# Yamaha DM7 외부 입력 조사 (8-A)

- 조사일: 2026-11-18
- 대상: **DM7 Compact**, 콘솔 펌웨어 **V2.1**, **DM Editor 2.x**(쇼 파일 `.dmxf`). 비교용으로 DM7 Editor V1.7.5(`.dm7f`)도 봄
- 근거 문서 (Yamaha 저작물이라 저장소에 넣지 않음, 로컬 `~/Documents/vender/dm7`)
  - **[RM]** DM7 시리즈 참고 설명서 (한국어, 447쪽)
  - **[OSC]** DM Series OSC Specifications V2.0.0 (2026-09-30, DM7/DM5 V2.0.0 대상)
  - **[CFC]** Console File Converter User Guide V6.2.0
- 샘플: 사용자가 DM Editor에서 저장한 파일
  - V1.7.5: base / name / color / patch / 48V / link
  - V2.x: basic / name / color / patch / link / 48V_local / 48V_dante
  - 실제 공연 파일 1개 (DM7C 모니터)

표기: ✅ 공식 문서로 확인 · 🔬 샘플 비교로 확인(비공식) · ❌ 그 방법으로 불가 · ❓ 미확인

## 1. 결론

1. **CSV·텍스트 가져오기는 없다.**
   - 콘솔이 읽고 쓰는 설정 파일은 `.dm7f` 하나다 ✅ [RM p.355–356].
   - DM Editor의 File 메뉴는 Load / Save / Save As / Import Scene/Library / Initialize Memory / Load User Key / Channel List뿐이다 ✅ [RM p.405, 화면 캡처].
2. **공식 경로는 두 가지다.**
   - **OSC**: 네트워크로 실시간 전송. 이름, 컬러, 아이콘, DCA 배정을 넣을 수 있다.
   - **CL/QL → DM7 Console File Converter**: 이름, 컬러, 아이콘, 페어, DCA·뮤트 배정은 옮겨지지만 패치는 옮겨지지 않는다.
3. **쇼 파일(`.dmxf`)은 공개되지 않은 형식이다.** 다만 필드 정의(스키마)가 파일 안에 함께 들어 있어서, 이름·컬러·아이콘·패치·48V·페어·DCA·뮤트의 위치를 모두 확인했다 🔬. 체크섬은 없다 🔬.

## 2. 항목별 입력 방법

| 항목 | OSC | CL→DM7 변환 | `.dmxf` 직접 작성 |
|---|---|---|---|
| 인풋 이름 | ✅ `MIXER:Current/InCh/Label/Name`, 최대 8자 [OSC p.4·9] | ✅ [CFC p.35] | 🔬 `Label/Name` 64바이트, UTF-8 |
| 컬러 | ✅ `…/Label/Color` [OSC p.4] | ✅ 비슷한 색으로 바뀜 [CFC p.35 주1] | 🔬 `Label/Color` 8바이트 문자열 |
| 아이콘 | ✅ `…/Label/Icon` [OSC p.9·18] | ✅ | 🔬 `Label/Icon` 12바이트 문자열 |
| 인풋 패치 | ❌ A/B 선택만 (`InCh/PatchSelect`) [OSC p.10] | ❌ [CFC p.35] | 🔬 `InPatch/Bank[A,B]/Source` u32 |
| 48V | ❌ (주소 없음) | ❓ (표에 없음) | 🔬 포트 단위: OMNI·Dante I/O 각각 |
| HA 게인 | ✅ `InCh/Port/HA/Gain` [OSC p.9] | ❓ | 🔬 `HeadAmp/Gain` |
| 스테레오 페어 | ✅ 링크 그룹 A–z `InputChLink/InCh/Assign` [OSC p.10·19] | ✅ [CFC p.35] | 🔬 아래 4절 |
| DCA 배정 | ✅ `InCh/DCA/Assign/<ch>/<dca>` [OSC p.6] | ✅ | 🔬 `DCA/Assign` 24비트 |
| 뮤트 그룹 배정 | ❌ (그룹 켜기·이름만) [OSC p.8] | ✅ | 🔬 `MuteGroup/Assign` 12비트 |
| Mix·Matrix·Stereo·DCA 이름/컬러 | ✅ [OSC p.6–12] | ✅ | 🔬 (위치 미정리) |
| 아웃풋 패치 | ❌ | ❌ [CFC p.35] | 🔬 위치 확인, 버스 소스 번호 ❓ |

- **OSC 연결:** UDP 49900, 콘솔 IP는 SETUP → NETWORK → "For Mixer Control", 원격 장치 최대 4대 ✅ [OSC p.3]
- **브라우저에서는 OSC를 쓸 수 없다:** 웹앱은 UDP를 보낼 수 없어서 별도 도우미 프로그램이 필요하다.

## 3. 제한 사항

| 항목 | 내용 | 근거 |
|---|---|---|
| 이름 글자 수 | 인풋·Mix·Matrix·Stereo·DCA·뮤트 그룹 **8자** | ✅ [OSC], 🔬 Editor V1.7.5·V2 모두 8자에서 입력이 멈춤 |
| 한글 | 콘솔에서는 영어만 입력, 다국어는 DM Editor·StageMix로 입력. 콘솔 Name Language 설정이 다르면 깨질 수 있음 | ✅ [RM p.95·257] |
| 한글 저장 방식 | UTF-8 (`킥드럼` = 9바이트, 64바이트 칸) | 🔬 |
| 컬러 (OSC) | Blue, Green, Orange, Pink, Purple, Red, SkyBlue, Yellow, Cyan, Magenta, Off | ✅ [OSC p.18 Table 3] |
| 컬러 (파일·Editor) | Blue(기본), Orange, Yellow, Purple, SkyBlue, Pink, Red, Green, LtGreen, White, OFF | 🔬 OSC와 목록이 다름. 같은 색인지 ❓ |
| 아이콘 (OSC) | Kick, Snare, Hi-Hat, TomTom, FloorTom … Wedge, In-Ear, Blank (68종) | ✅ [OSC p.18 Table 4] |
| 아이콘 (파일에서 관찰) | Kick, Snare, Hi-Hat, Tom, F.Tom, Cymbal, A.Bass, E.Bass, BassAmp, A.Guitar, E.Guitar, GuitarAmp, Keyboard, Piano, Strings, Media1, Wireless, Dynamic, Podium, Wedge, In-Ears, Blank | 🔬 OSC와 이름이 다름 |
| 채널 수 | 인풋 DM7 120 / DM7 Compact 72, Mix 48, Matrix 12, DCA 24, 뮤트 그룹 12 | ✅ [OSC p.19], 🔬 파일 구조는 120채널로 같음 |
| 파일 이름 | 16자, 설명 54자 | ✅ [RM p.355] |
| 변환기 | CL/QL → DM7만 가능하고 반대 불가. DM7 파일은 라이브러리를 변환하지 않음. 일부 펌웨어·에디터 버전 조합은 지원 안 됨 | ✅ [CFC p.4·8–9·35] |
| 버전 | DM Editor 1.7.5(`.dm7f`)와 2.x(`.dmxf`)는 섹션 크기와 레코드 시작 위치가 다름. 콘솔 V2.1에는 Editor 2.x를 쓸 것 | 🔬 |

## 4. 쇼 파일 구조 (비공식, 🔬)

### 4.1 바깥 컨테이너 (`.dmxf` / `.dm7f`)

- **머리말**
  - `#YAMAHA MBDFProjectFile`, 기종 `DM7`
  - 형식 버전 4바이트: V2 = `56 02 01 00`, V1.7.5 = `56 01 4b 00`
  - **UUID v4 16바이트**(저장할 때마다 새로 생김, 체크섬 아님)
  - ProjectInfo: 머리말 자체가 MBDF 섹션(스키마 포함)이라 `Info/{ProductName, ProductSubName, Comment, OwnerName, Category, UnitMode}`와 `Info/TimeStamp/{Year(2), Month, Day, Hour, Minute, Second}`를 스키마로 읽는다 🔬
    - 기종: ProductName `DM7`, ProductSubName `DM7C`
    - **저장 시각은 UTC** 🔬 — `basic` 06:32:58 = 파일 시각 15:32(KST), `rio_base` 02:28:54 = 11:28(KST). 8-D의 기준 파일 정보에 쓴다
- **블록** `#FILE` × 8 (4바이트 정렬). 블록 머리는 빅엔디언이다.

  | 위치 | 내용 |
  |---|---|
  | +0 | `#FILE` + 0 ×7 |
  | +12 | 분류 이름 12바이트 (`Current`, `Setup`, `PresetList`, `SceneList`, `Scn/UserA` …) |
  | +24 | u32 = 파일 이름 길이 + 8 |
  | +28 | u32 = **압축 크기** |
  | +32 | u32 = 0 |
  | +36 | u16 = 파일 이름 길이, u16 = 0 |
  | +40 | u32 = 8 |
  | +44 | 파일 이름 (4바이트 정렬까지 0으로 채움) |
  | 그 뒤 | zlib 압축 내용 |

- **꼬리**: 정렬용 0 + `#END` + 0 ×32
- **내부 파일**: `CurrentBackupFile.bup`(지금 상태), `.bup.old`(같은 내용), Setup, PresetList, SceneList, 장면 `*.dm7s`

### 4.2 내부 파일 (MBDF Backup)

- 머리말 `#YAMAHA MBDFBackup`, 형식 버전, UUID v4
- 그 뒤로 섹션이 이어진다. Current의 섹션은 `Mixing`, `Processing`, `FX`, `PremiumRack`, `Scene`, `Preset`.
- 섹션 구조: `#MMS FIELD` + `MMSXLIT` + 스키마 버전 `01.00.00 A` + 스키마 해시 + **스키마 항목들** + 데이터
- **스키마 항목** (리틀엔디언)

  | 종류 | 크기 | 구성 |
  |---|---|---|
  | 컬렉션 | 48바이트 | `COL0` + 이름(24) + u32 ×5 {플래그, ?, **오프셋**, **크기**, **개수**} |
  | 필드 | 32바이트 | `PR ` + 형식(0 문자열, 1 부호 정수, 2 부호 없는 정수) + u16 크기 + u16 개수 + 이름(24) |

  - 크기가 0인 필드는 **비트**다. 개수만큼 비트가 이어진다.
- **중첩 규칙**: 항목이 현재 컬렉션의 남은 범위 안에 들어가면 그 컬렉션의 자식이다. 이 규칙으로 계산한 위치가 샘플 비교 결과와 모두 일치했다.

### 4.3 확인된 위치 (V2 기준. 시작 위치는 버전마다 다르므로 스키마로 계산할 것)

`Mixing/InputChannel` (1,785바이트 × 120)

| 오프셋 | 필드 | 값 |
|---|---|---|
| +0 비트0·1 | `GainGang`, `DelayGang` | 페어 시 둘 다 1 |
| +1 | `Signal/Relation` | 페어 L = `0x80`, R = `0x01`, 단독 = `0x00` |
| +10 | `Label/Name` (64) | UTF-8, 0으로 끝남 |
| +74 | `Label/Color` (8) | 영문 문자열 |
| +82 | `Label/Icon` (12) | 영문 문자열 |
| +94 | `InPatch/Select` (비트) | 0 = Bank A |
| +95 / +99 | `InPatch/Bank[A,B]/Source` (u32) | 아래 소스 번호 |
| +1753 | `ToStereo/PanType` (12) | 단독 `PAN`, 페어 `BALANCE` |
| +1767 | `DCA/Assign` (24비트) | 비트 n-1 = DCA n |
| +1770 | `MuteGroup/Assign` (12비트) | 비트 n-1 = 뮤트 n. 페어 상대도 함께 켜짐 |

**인풋 소스 번호** (u32)

| 값 | 의미 |
|---|---|
| `0x01401000 + (n-1)` | OMNI n (기본 패치: Ch n = OMNI n) |
| `0x01A00000 + (n-1)` | Dante n |
| `0x00000000` | 없음 (실제 공연 파일에서 관찰) |

**48V** (포트 단위)

| 대상 | 위치 |
|---|---|
| OMNI n | `Processing/Omni/InputPort[n](7바이트)/HeadAmp(+1)/48V` 비트 |
| Dante I/O(Rio 등) | `Mixing/DanteRemoteControl/IOUnit[u](0x480)/InputPort[p](9바이트)/HeadAmp/48V` 비트 |

- **`IOUnit[u]` = Rio의 UNIT ID** 🔬 — 콘솔에서 저장한 실기 샘플(Rio1608-D, UNIT ID #1)에서 Rio 1번 입력 48V가 `IOUnit[0]/InputPort[0]`(OnePatch "I/O 유닛 1", 포트 1)에 기록됨. DM Editor Dante I/O Device 화면의 칸 `#1`~`#24`와 같은 번호.
  - UNIT ID 2 이상, Rio의 2번 이후 포트는 아직 샘플 없음 ❓ (스키마상 유닛 0x480, 포트 9바이트 간격)
- 같은 `HeadAmp`의 `Gain`(2바이트, 부호 있음)은 0.01 dB 단위: −6 dB = `-600`, +30 dB = `3000` 🔬 (OnePatch는 쓰지 않음)
- 페어를 맺을 때 Ch3 이름이 지워진 것은 Editor 동작인지 사용자 조작인지 ❓

### 4.4 아웃풋 패치 (샘플 `outpatch`: Mix 2 → Dante OUT 1 / `outpatch2`: Matrix 1 → OMNI OUT 1, Stereo L·R → OMNI OUT 2·3)

- 위치: `Processing/{Omni[16], AES[4], PY[64], USB[32], Dante[144], Recorder[2]}/OutputPort[n]/Patch/Source` (u32, 포트 → 소스)
- 소스 번호
  - `0x03E00000 + (n-1)` = **Mix n**: Mix 2 → Dante OUT 1이 `0x03E00001`로 저장됨 🔬
  - 기본값은 OMNI OUT n = Mix n, Dante OUT n = Mix n
  - `0x04000000 + (n-1)` = **Matrix n** 🔬 (USB OUT 기본값도 이 계열)
  - `0x04200000` / `0x04200001` = **Stereo (A) L / R** 🔬 (AES·Recorder 기본값)
  - `0x04200010` = **Stereo B** (L) 🔬 (샘플 `outpatch3`: Stereo B → OMNI OUT 1)
  - "없음" = `0x00000000` 🔬 (샘플에서 OMNI OUT 2와 Dante OUT 2–4는 사용자가 직접 "없음"으로 바꿈 → Editor가 자동으로 지우지 않음)
- 미확인 ❓
  - **Stereo B**의 R 소스 번호 (L은 `0x04200010`으로 확인, R은 샘플 없음 → 쓰지 않음)
  - 스테레오 Mix·Matrix의 페어(Bus Setup) 설정 위치 — OnePatch는 출력 패치만 쓴다

### 4.5 버스·DCA·뮤트 그룹 이름 (샘플 `busmane`: Mix 1 `WEDGE1`, DCA 1 `DRUMS`, 뮤트 그룹 1 `BUSMANE`)

- 위치: `Mixing/{Mix[48], Matrix[12], Stereo[4], DCA[24]}/Label/{Name, Color, Icon}` — 인풋과 같은 모양(64 + 8 + 12바이트). `Mixing/Mute[12]/Label/Name`(64)만 이름뿐 🔬
- 기본 이름: `MX 1`, `MT 1`, `ST A`(Stereo 4개: A L, A R, B L, B R), `DCA 1`, `Mute 1`
- Mix·Matrix·Stereo에도 `DCA/Assign`, `MuteGroup/Assign` 비트가 있다(샘플에서 Mix 1 뮤트 배정이 함께 바뀜) — OnePatch 아웃풋에는 아직 DCA·뮤트 항목이 없어 쓰지 않음

## 5. 8-B 구현과 검증

- **구현 위치:** `src/export/dm7/` (container, mbdf, dm7Export), 화면 `/shows/[id]/console`
- **버스·DCA·뮤트 그룹 이름:** 아웃풋 패치와 같은 번호 배정을 따라 이름(8자)을 쓴다. 스테레오 버스는 Mix 두 개에 같은 이름을 쓴다. 빈 이름이면 파일의 기본 이름을 그대로 둔다.
- **아웃풋 패치:** Aux는 표의 행 순서대로 Mix 번호를 받고, 스테레오 버스는 홀수에서 시작하는 두 개를 받는다. Matrix도 같은 방식이다. 첫 스테레오 Main은 Stereo A. 박스 출력은 "Dante OUT 시작 번호" 설정으로, Local은 OMNI OUT으로 간다. 쓰지 않는 출력을 "없음"으로 비울지 고를 수 있다.
- **방식:** 사용자가 DM Editor에서 저장한 파일의 `CurrentBackupFile.bup`(과 `.old`)만 고쳐 쓴다. 다른 블록은 원래 압축 바이트를 그대로 둔다.
- **검증** (`src/__tests__/dm7.test.ts`, 샘플이 있을 때만 실행)
  - 아웃풋 패치 샘플 `outpatch2`도 바이트까지 같다. `outpatch`의 Mix 2 → Dante OUT 1 값도 같다.
  - 사용자가 DM Editor에서 직접 한 6단계 변경(이름, 컬러, 패치, 페어·DCA·뮤트, 48V OMNI, 48V Dante)을 OnePatch로 똑같이 넣었을 때, Current 데이터가 UUID를 빼고 **바이트까지 같다**.
  - 고치지 않고 다시 쓰면 원본 파일과 바이트까지 같다.
- **실기 검증 (2026-11-18)**
  - DM Editor 2.x: OnePatch가 쓴 파일이 열리고, 다시 저장해도 Current 데이터는 그대로 🔬. 셋업은 화면 상태 2바이트만 다름.
  - DM Editor에서 인풋(이름·컬러·패치·페어·DCA)·아웃풋 패치·버스·DCA·뮤트 이름이 기대값대로 표시됨 (사용자 확인)
  - **DM7 Compact 콘솔(FW V2.1)에서 USB로 불러오기 성공** (사용자 확인)
- **실기 검증 (8-C, 2026-11-19)** — DM7 Compact **FW V2.0**(앞서 V2.1로 적은 것을 사용자가 정정) + Rio1608-D 1대(UNIT ID #1)
  - 불러오기: 성공, 오류 없음
  - 인풋(이름·컬러·패치·48V·페어·DCA·뮤트), 아웃풋 패치, 버스·DCA·뮤트 이름: 모두 맞게 들어감 (사용자 확인)
  - 한글 이름: 콘솔 화면에서 정상 표시
  - Rio 신호: 정상 (사용자 확인). DM Editor 온라인 화면에서 Rio1608-D #1에 `+48V Active` 표시
  - 다르게 들어간 항목: 없음 → 고칠 것 없음
  - Rio 샘플(`rio_base`, `rio_48V_1`, `rio_48V_5`, `rio_gian`)로 유닛 번호 대응을 확인하고 테스트로 남김. `rio_48V_5`는 Rio 5번이 아니라 **OMNI 5** 48V가 켜져 있어 Rio 포트 간격 확인에는 쓰지 못함

### 4.6 읽기(10단계)에서 새로 확인한 것

- **Mix의 스테레오** 🔬: `Mixing/Mix[n]/Signal/Relation`이 인풋 페어와 같이 L = `0x80`, R = `0x01`. 실제 공연 파일(IndieMusicDay MON)의 `IEM1 L`/`IEM1 R` … Mix 3/4 ~ 13/14에서 확인. Matrix도 같은 칸이 있으면 같은 방식으로 읽는다(샘플 없음 ❓). `BusType`은 모두 `VARI`.
  - OnePatch 내보내기는 아직 이 칸을 쓰지 않는다(Bus Setup은 콘솔에서). 그래서 읽을 때는 Relation이 없으면 "홀수·짝수 Mix 이름이 같음"도 스테레오로 본다.
- **Stereo B R 소스 = `0x04200011`** (관찰): DM Editor 기본 파일(`basic`)의 기본 출력 패치에서 Dante OUT 63 = `0x04200010`(Stereo B L), 64 = `0x04200011`. 직접 바꿔 저장한 샘플은 아직 없어 내보내기에는 쓰지 않고, 읽기와 표시에만 쓴다.
- **기본 이름**: 인풋 `ch 1`~`ch 9`, `ch10`~; Mix `MX 1`/`MX10`; Matrix `MT 1`/`MT10`(V2)·`MT 10`(V1); Stereo `ST A`·`ST B`; `DCA 1`/`DCA10`; `Mute 1`/`Mute10`. 기본 컬러 `Blue`, 아이콘 `Blank`.
- **기본 출력 패치**(`basic`): OMNI OUT 1–14 = Mix 1–14, 15/16 = Stereo A L/R, Dante OUT 1–48 = Mix 1–48, 49–60 = Matrix 1–12, 61/62 = Stereo A, 63/64 = Stereo B.
- 실제 공연 파일의 인풋 49–72 패치 `0x06c000xx`(xx = 00, 01, 20, 21 … f0, f1)는 무엇인지 모름 ❓ (Dante·OMNI 외 — 녹음/USB 등으로 추정만). 읽을 때는 패치를 비운다.

## 5-1. 8-D 현장용 다듬기

- **기준 파일 보관**: 한 번 올린 `.dmxf`를 IndexedDB(`consoleFiles`, 키 `dm7`)에 원본 바이트 그대로 보관 → 모든 Show에서 다시 올리지 않고 내보낸다. 기종·형식 버전·저장 시각(머리말)을 보여주고 교체·삭제한다.
- **콘솔 프로필** (`src/export/profile.ts`): 이름 글자 수(8), 채널(DM7 Compact 72 / DM7 120)·Mix 48·Matrix 12·Stereo 2·DCA 24·뮤트 12, 컬러 목록·대응, 아이콘 목록(4.x에서 관찰한 이름만)과 소스·악기군별 아이콘. 오류 검사의 이름 글자 수도 이 값을 쓴다.
- **내보내기 전 점검** (`src/export/checks.ts`): 글자 수 넘는 이름(줄인 이름 제안, 그 자리에서 고치기), 콘솔에 없는 컬러(갈색 → Orange, 회색 → White 제안, 고르면 해결), 기종 한도, 오류 검사 경고.
- **아이콘 자동**: 내 소스 목록의 소스·악기군 → 보컬 이름(무선이면 Wireless) → 이름 규칙 → 없으면 `Blank`. 관악·국악 관악·타악(장구·북)·퍼커션은 관찰된 아이콘이 없어 Blank.
- **콘솔에서 직접 할 일** (`src/export/dm7/tasks.ts`, 인쇄 화면 “콘솔 할 일”): Dante 연결·UNIT ID, Name Language(한글 이름이 있을 때), 채널별 게인·HPF·EQ·다이내믹스, Bus Setup 스테레오, Aux 센드 Pre/Post, FX, Matrix 소스, Stereo B R, Scene 저장·백업.
- **결과 요약**: 항목별로 넣은 수와 그중 파일과 달라 바뀐 수, 넣지 않는 것. 기준 파일의 다른 블록은 원래 압축 바이트 그대로(테스트로 확인).

## 5-2. 10단계 쇼 파일 읽기

- `src/export/dm7/dm7Import.ts`: 파일 → 기종 중립 스냅샷(채널·버스·DCA·뮤트). 위치는 모두 스키마로 계산.
- `src/export/importShow.ts`: 스냅샷 → 새 Show(이름으로 소스 목록 찾기, 기본 이름 건너뛰기 선택), 기존 Show와 비교한 "콘솔 변경분"(고른 것만 반영, 마이크·스탠드·비고는 그대로).
- 검증: 샘플 Show를 내보낸 파일을 다시 읽으면 콘솔로 가는 내용이 같고 변경분 0개(왕복 테스트). 실제 공연 파일(DM Editor 1.x)에서 36채널·스테레오 IEM 6개 Show가 만들어짐.

## 5-3. 마이너 업데이트 (실사용 수정 10가지)

- **48V 처리** (`Dm7Options.phantomMode`, 내보내기 화면 "48V 처리"): `off`(기본) — OnePatch가 인풋에 패치하는 포트(OMNI, I/O 유닛이 있는 박스의 Dante I/O)의 48V 비트를 모두 0으로. `keep` — 48V 비트를 건드리지 않음. `sheet` — 예전 동작(시트의 48V대로), "마이크 연결 전에 팬텀이 걸립니다" 경고. 예전에 저장한 내보내기 설정에도 기본은 `off`.
  - 검증: 실기 샘플 `rio_48V_5`(Rio 1번·OMNI 5 48V 켜짐)를 기준 파일로 기본값 내보내기 → 두 비트 모두 0. 기존 바이트 일치·실기 테스트는 `sheet`로 실행해 그대로 통과.
  - 인쇄 "48V 체크리스트"(팬텀이 필요한 채널만 포트 순서, 리본은 따로)와 "콘솔 할 일"의 "48V 켜기 n채널"로 콘솔에서 직접 켠다.
- **박스 없는 포트**: 데이터 모델에 `PortRef` 종류 `dante`(콘솔의 n번 Dante 입출력 직결) 추가. 인풋 `Dante n` → 패치 소스 `0x01a00000 + (n-1)`(48V는 장치 쪽이라 다루지 않음), 출력 `Dante n` → `Dante/OutputPort[n-1]`. 로컬 단자(`local`)는 화면에 "OMNI n"으로 표기(예전 "Local n", "L1"도 읽음).
- **Main 없는 Show**: "쓰지 않는 출력 비우기"를 켜도, Show에 해당 Main이 없으면 지금 Stereo A/B(`0x04200000/+1`, `0x04200010/+1`)가 나가는 OMNI·Dante OUT은 그대로 둔다 → 기준 파일의 Stereo 출력 패치를 건드리지 않음(샘플 `basic`으로 테스트).
- **읽기**: 소스 찾기가 영문 이름(국악 로마자), 8자로 줄인 번호 이름(`Gayagem2`), 예전 기본 짧은 이름(`Gaya2`)도 알아본다.

## 6. 남은 확인 사항

- Rio UNIT ID 2 이상의 유닛 번호, Rio 2번 이후 포트의 48V 위치 (Rio 2대 연결 샘플, Rio 5번 48V 샘플 필요)
- Stereo B R의 출력 소스 번호
- 파일 컬러 `LtGreen`/`White`와 OSC 컬러 `Cyan`/`Magenta`의 관계
- 콘솔 V2.1이 V1의 `.dm7f`를 불러오는지
