# AGENTS 작업 규칙

본 문서는 Obsidian 볼트(vault) AILSS 전역에 적용되는 규칙이에요. 2025-11-11 기준 볼트 구조 현황을 반영해 개선 지침을 포함해요.

## 0. 핵심(TL;DR)
- 모든 요청은 sequential thinking(순차 사고, sequential thinking)으로 단계 분해하고 nextThoughtNeeded=false 전까지 실행 금지해요.
- 단일 문헌/페이지 근거는 Fetch(페치, fetch)로 원문 확보해요. 다만 Obsidian 내부 지식은 Obsidian MCP(옵시디언 MCP)로 먼저 질의해요.
- 노트는 프론트매터(front matter)와 본문(body)을 분리하고, 의미 관계는 프론트매터 타입드 링크(typed link)로만 기록해요.
- 의미론적 분석 이후 적용 가능한 모든 타입 링크 후보를 검토하고 프론트매터에 적절히 추가해 구조화해요.
- 위키 링크(wikilink)는 본문에서 자유롭게 사용하고, 깨진 링크는 작업 전후로 반드시 점검해요.
- 자산(asset)은 문서 인접 `assets/` 폴더에 두고 상대 경로(relative path)로 임베드해요.
- Obsidian MCP 도구 사용은 강제해요: 요약·분류·리뷰 작업 전 반드시 MCP 질의로 원문/메타를 조회해요.

### 현재 볼트 구조 요약(2025-11-11)
- 최상위 폴더: `0. System`, `1. Main`, `10. Projects`, `20. Areas`, `30. Resources`, `40. Archives`, `100. Inbox`, `101. Need to Review` 구성이에요.
- 마크다운 파일 수: 총 494개, 그중 프론트매터를 가진 파일 281개(약 57%)예요.
- 프론트매터 미적용 샘플(정비 우선 순위):
  - `0. System/Reset Frontmatter.md`
  - `10. Projects/10. HouMe/OLD/CI_빌드실패_원인분석_및_수정보고서_LoadingPage.md`
  - `10. Projects/10. HouMe/OLD/DIAGNOSIS.md`
  - `10. Projects/10. HouMe/OLD/PR_LOADING_PAGE.md`
  - `10. Projects/10. HouMe/OLD/TYPE_GUARD_NOTES.md`

### 즉시 개선 액션
- 템플릿을 적용하지 않은 노트에 프론트매터 일괄 추가해요(아래 부록 예시 활용).
- `10. Projects/10. HouMe/OLD/` 하위 노트는 `entity: document`, `layer: physical`로 우선 표준화하고 후속 재분류해요.
- 작업 단위마다 `rg "\[\[" -n`으로 깨진 링크를 점검하고, 자산은 인접 `assets/`로 이동해요.

이 문서는 README.md에서 정의한 온톨로지(ontology), 레이어(layer), 타입드 링크(typed link) 지침에 대한 정리입니다.

## 1. 프론트매터 스키마

모든 노트는 아래 프론트매터(front matter) 템플릿을 기본으로 유지해요.

```
---
id: {{date:YYYYMMDDHHmmss}}
created: {{date:YYYY-MM-DDTHH:mm:ss}}
title: {{title}}
summary: 
aliases:
# concept | document | project | artifact | person | organization | place | event | task | method | tool | idea | principle | heuristic | pattern | definition | question | software | dataset | pipeline | procedure | dashboard | checklist | workflow | decide | review | plan | implement | approve | reject | observe | measure | test | verify | learn | research | summarize | publish | meet | audit | deploy | rollback | refactor | design | delete | update | create | schedule | migrate | reference | hub
entity: 
# strategic | conceptual | logical | physical | operational
# 왜 / 무엇 / 어떻게 / 구현 / 운영
layer: conceptual
tags: ['inbox']
keywords: []
# draft | in-review | published | archived
status: draft
updated: {{date:YYYY-MM-DDTHH:mm:ss}}
viewed: 0
source: []
instance_of: [] # 종류의 한 사례
part_of: [] # 부분
uses: []
depends_on: []
implements: []
see_also: []
---
```

### 필드 운용 원칙
- 프론트매터는 지식 그래프의 일관성을 위한 최소 메타데이터 집합이에요.
- `entity`(엔티티) 필드는 개념(concept), 문서(document), 프로젝트(project), 가이드(guide), 도구(tool) 등 README에서 허용한 목록을 사용해요.
- `layer`(레이어) 필드는 strategic(왜), conceptual(무엇), logical(구조), physical(구현), operational(운영) 중에서 선택해요.
- `status`는 draft, in-review, published, archived 중에서 현재 상태를 표시해요.
- 관계 키(keys)는 `instance_of`, `part_of`, `depends_on`, `uses`, `implements`, `see_also`, `cites`, `authored_by`, `supersedes`, `same_as` 등을 사용해요.
- 확신이 없으면 `layer`를 일시적으로 비워 두거나 `conceptual`로 두고 리뷰에서 조정해도 괜찮아요.
- `tags`, `aliases`, `keywords`, `source`, `viewed` 값은 필요할 때만 채워요.

## 2. 레이어 정의와 판별 기준

- **strategic(왜)**: 비전, 원칙, 로드맵, 상위 의사결정 맥락을 다뤄요.
- **conceptual(무엇)**: 개념, 정의, 원리, 패턴처럼 도구에 독립적인 보편 지식을 다뤄요.
- **logical(어떻게 구조화)**: 도메인 모델, 데이터 흐름, 프로토콜 같은 구현 독립 구조를 다뤄요.
- **physical(무엇으로 구현)**: 코드, 설정, 레포, 버전, 파일 같은 구체 구현을 다뤄요.
- **operational(운영/관측)**: 배포, 런북, 모니터링, 인시던트, 실행 로그 등 운영과 관측을 다뤄요.

> **한 줄 테스트**
> - 전략을 바꾸면 나머지가 바뀌면 strategic으로 분류해요.
> - 도구를 바꿔도 본질이 유지되면 conceptual로 분류해요.
> - 구조와 규칙만 정의되어 있고 구현이 미정이면 logical로 분류해요.
> - 구체 파일·레포·버전·설정이 핵심이면 physical로 분류해요.
> - 시간, 사건, 운영 절차와 결과가 중심이면 operational로 분류해요.

**엔티티→레이어 추천 매핑**
- `concept/definition/pattern/principle/heuristic`는 주로 conceptual에 두어요.
- `method`는 내용에 따라 conceptual 또는 logical로 분류해요.
- `api-spec/model`은 logical에 두고, 실제 스키마 파일이면 physical로 옮겨요.
- `software/tool/dataset/artifact`는 physical로 분류해요.
- `guide/runbook/dashboard`는 운영 절차 중심이면 operational에 두어요.
- `decision/incident/log/event`는 operational에 두어요.
- `project`는 방향과 목표를 다루면 strategic, 구조 문서면 logical에 두어요.
- 망설이면 일단 conceptual로 두고 후속 리뷰에서 조정해요.

## 3. 엔티티 분류 테이블

`entity` 후보는 interface 계열, action 계열, object 계열로 나눠 README와 동일하게 관리해요.

### 3.1 Interface 계열

| entity        | 기본 레이어          | 보조 레이어(상황별)           | 이유 한 줄                                               |
| ------------- | --------------- | --------------------- | ---------------------------------------------------- |
| **interface** | **logical**     | physical              | API·모듈 표면(사양/계약)은 구조 정의가 핵심이라 논리층이에요. 실제 IDL·파일이면 물리층이에요. |
| **pipeline**  | **logical**     | physical, operational | 단계·흐름 설계가 본질이라 논리층이에요. CI 설정(YAML)·러너면 물리층, 실행·모니터링이면 운영층이에요. |
| **procedure** | **operational** | —                     | 절차·런북 자체가 운영 행위 중심이라 운영층이에요. |
| **dashboard** | **operational** | physical              | 관측·알람·지표를 다루는 운영 활동이라 운영층이에요. 구현체(JSON 등)이면 물리층이에요. |
| **checklist** | **operational** | conceptual            | 실행 확인용 체크는 운영층이에요. 도구 불문 원칙·항목 템플릿이면 개념층이에요. |
| **workflow**  | **logical**     | operational           | 업무·프로세스 구조가 핵심이라 논리층이에요. 실제 인스턴스 실행·승인 흐름이면 운영층이에요. |

### 3.2 Action 계열

| action        | 기본 레이어          | 보조 레이어(상황별)         | 이유 한 줄                                                 |
| ------------- | --------------- | ------------------- | ------------------------------------------------------ |
| **decide**    | **strategic**   | operational         | 상위 맥락·원칙·ADR 결정이 핵심이라 전략층이에요. 게이트 결재 행위면 운영층이에요.       |
| **review**    | **operational** | strategic, logical  | PR·문서·릴리스 리뷰는 시간·행위 중심이라 운영층이에요. 로드맵·아키 리뷰면 전략/논리층이에요. |
| **plan**      | **strategic**   | operational         | 비전·로드맵·OKR 수립은 전략층이에요. 스프린트 캘린더 배치는 운영층이에요.            |
| **implement** | **physical**    | operational         | 코드·설정·리포 구현은 물리층이에요. 구현 작업 추적은 운영층이에요.                 |
| **approve**   | **operational** | strategic           | 게이트 통과·결재는 이벤트 중심이라 운영층이에요. 정책 승인 원칙이면 전략층이에요.         |
| **reject**    | **operational** | —                   | 승인·거부 이벤트라 운영층이에요.                                     |
| **observe**   | **operational** | —                   | 모니터링·관찰 행위라 운영층이에요.                                    |
| **measure**   | **operational** | conceptual          | 지표 수집·기록은 운영층이에요. 측정 정의는 개념층이에요.                       |
| **test**      | **operational** | physical, logical   | 테스트 실행·결과는 운영층이에요. 테스트 코드·스펙은 물리층, 전략·원칙은 논리층이에요.      |
| **verify**    | **operational** | —                   | 검증 행위·게이트라 운영층이에요.                                     |
| **learn**     | **conceptual**  | operational         | 지식·교훈 정리는 보편 지식이라 개념층이에요. 회고 이벤트 자체는 운영층이에요.           |
| **research**  | **conceptual**  | strategic           | 도구 독립 조사·탐색이라 개념층이에요. 방향성 연구면 전략층이에요.                  |
| **summarize** | **conceptual**  | operational         | 지식 정리 산출은 개념층이에요. 릴리스 노트 작성 등 이벤트에 묶이면 운영층이에요.         |
| **publish**   | **operational** | physical            | 배포·공지·문서 공개는 실행 결과라 운영층이에요. 아티팩트 생성·업로드면 물리층이에요.       |
| **meet**      | **operational** | —                   | 일정 기반 회의라 운영층이에요.                                      |
| **audit**     | **operational** | strategic           | 점검·컴플라이언스 활동은 운영층이에요. 정책·기준 수립이면 전략층이에요.               |
| **deploy**    | **operational** | physical            | 배포 실행·로그는 운영층이에요. 배포 스크립트·매니페스트는 물리층이에요.               |
| **rollback**  | **operational** | physical            | 롤백 실행·결과는 운영층이에요. 롤백 스크립트·스냅샷은 물리층이에요.                 |
| **refactor**  | **physical**    | logical             | 코드·구성 변경은 물리층이에요. 리팩터링 규칙·구조 원칙은 논리층이에요.               |
| **design**    | **logical**     | strategic, physical | 아키텍처·모델 설계는 논리층이에요. 원칙·비전 수준이면 전략층, 산출물이 파일이면 물리층이에요.  |
| **delete**    | **physical**    | operational         | 파일·데이터 삭제는 물리층이에요. 운영 절차(삭제 윈도우)는 운영층이에요.              |
| **update**    | **physical**    | operational         | 코드·설정·스키마 변경은 물리층이에요. 변경 관리 이벤트는 운영층이에요.               |
| **create**    | **physical**    | operational         | 아티팩트·리소스 생성은 물리층이에요. 작업 트래킹은 운영층이에요.                   |
| **schedule**  | **operational** | strategic           | 시간 배치·캘린더링은 운영층이에요. 장기 로드맵 편성은 전략층이에요.                 |
| **migrate**   | **operational** | physical            | 마이그레이션 실행·절차는 운영층이에요. 스크립트·매핑은 물리층이에요.                 |
| **analyze**   | **conceptual**  | operational         | 분석 활동은 통찰 생성이라 개념층이에요. 운영 로그·사건 분석이면 운영층이에요.           |

### 3.3 Object 계열

| object           | 기본 레이어          | 보조 레이어(상황별)          | 이유 한 줄                                            |
| ---------------- | --------------- | -------------------- | ------------------------------------------------- |
| **concept**      | **conceptual**  | —                    | 보편 개념·정의를 다뤄서 개념층이에요. |
| **document**     | **physical**    | conceptual           | 파일·위키·문서라는 구현물이라 물리층이에요. 내용이 순수 정의라면 개념층이에요. |
| **project**      | **strategic**   | logical              | 방향·목표·스코프가 핵심이라 전략층이에요. 초기 구조 문서면 논리층이에요. |
| **artifact**     | **physical**    | —                    | 빌드 결과물·산출물이라 물리층이에요. |
| **person**       | **logical**     | operational          | 도메인 엔터티로서 사람 모델이라 논리층이에요. 일정·행동 로그는 운영층이에요. |
| **organization** | **logical**     | strategic            | 도메인 엔터티라 논리층이에요. 거버넌스·정책 맥락이면 전략층이에요. |
| **place**        | **logical**     | operational          | 도메인 엔터티라 논리층이에요. 이벤트 맥락이 붙으면 운영층이에요. |
| **event**        | **operational** | logical              | 시간·사건 중심이라 운영층이에요. 이벤트 타입 정의는 논리층이에요. |
| **task**         | **operational** | logical              | 실행 단위·백로그라 운영층이에요. 태스크 타입/상태 모델은 논리층이에요. |
| **method**       | **conceptual**  | logical              | 절차·방법의 보편 설명이라 개념층이에요. 프로토콜·단계 구조화면 논리층이에요. |
| **tool**         | **physical**    | conceptual           | 특정 소프트웨어·서비스라 물리층이에요. 도구 불문 원칙 설명이면 개념층이에요. |
| **idea**         | **conceptual**  | —                    | 아이디어·영감은 보편 지식이라 개념층이에요. |
| **principle**    | **conceptual**  | strategic            | 원칙·가이드라인은 개념층이에요. 상위 의사결정 문맥이면 전략층이에요. |
| **heuristic**    | **conceptual**  | —                    | 경험칙·요령이라 개념층이에요. |
| **pattern**      | **conceptual**  | logical              | 재사용 구조 아이디어라 개념층이에요. 시스템에 투영되면 논리층이에요. |
| **definition**   | **conceptual**  | —                    | 용어·정의를 다뤄서 개념층이에요. |
| **question**     | **conceptual**  | —                    | 도구 독립 탐구 단위라 개념층이에요. |
| **software**     | **physical**    | —                    | 구체 소프트웨어·패키지·버전이라 물리층이에요. |
| **dataset**      | **physical**    | —                    | 구체 데이터·스키마·버전이라 물리층이에요. |
| **reference**    | **conceptual**  | physical             | 참고 지식이라 개념층이에요. 특정 문서·링크 파일이면 물리층이에요. |
| **hub**          | **physical**    | logical              | 위키·포털·모노레포 등 구체 장소라 물리층이에요. 구조 정의면 논리층이에요. |
| **guide**        | **operational** | conceptual           | 절차 중심 가이드라 운영층이에요. 순수 원리 위주면 개념층이에요. |
| **definition**   | **conceptual**  | -                    | 용어·개념 정의는 반복적으로 개념층이에요. |
| **log**          | **operational** | physical, logical    | 실행·운영에서 발생한 사실 기록이라 운영층이에요. 스키마·구조는 물리/논리층이에요. |
| **structure**    | logical         | physical, conceptual | 모듈·패키지·도메인 배치·경계 규칙이라 논리층이에요. 구현에 닿으면 물리층, 원리 논의면 개념층이에요. |
| **architecture** | logical         | strategic, physical  | 시스템 구성·흐름·경계 설계라 논리층이에요. 원칙 수준이면 전략층, 파일이면 물리층이에요. |

## 4. Typed Links 규칙

- 의미 관계(semantic relation)는 프론트매터(front matter)의 타입드 링크(typed link)로만 정방향(forward) 기록해요.
- 역방향 관계는 쿼리나 그래프에서 추론하기 때문에 별도로 기록하지 않아요.
- 예시: `part_of: [[WorldAce]]`, `depends_on: [[Vite]]`, `instance_of: [[guide]]`처럼 작성해요.
- 본문(body)에서는 자유롭게 위키링크(wikilink)를 쓰되 의미적 관계는 반드시 프론트매터로 승격해요.
- 핵심 원칙: 프론트매터에 이미 있는 키만 채우는 게 아니라 의미론적 분석(semantic analysis) 이후 적용 가능한 모든 타입 링크 후보를 검토하고 적절한 것을 추가해 구조화해요.

### 4.1 타입 링크 카테고리와 최소 세트

- 분류(taxonomy): `instance_of`
- 구성(composition): `part_of`
- 의존(dependency): `depends_on`, `uses`
- 구현(implementation): `implements`
- 인용(citation): `cites`
- 저작과 귀속(authorship, attribution): `authored_by`
- 동등과 버전(equivalence, versioning): `same_as`, `supersedes`

설명: 위 목록은 README에서 허용한 키(keys)를 중심으로 한 최소 세트예요. 새로운 키를 사용하고 싶으면 먼저 README 온톨로지에 추가한 뒤 적용해요.

### 4.2 의미론적 분석 기반 관계 도출 절차

1) 대상 노트 S의 정체성 파악(identity): `title`, `entity`, `layer`, `summary`를 먼저 확정해요.
2) 후보 엔티티 수집(candidates): 본문과 위키링크, 파일 경로, 기존 프론트매터에서 명사구를 추출해요.
3) 의미 검색(semantic search): `search_vault_smart`로 아래 쿼리를 실행해 관계 후보를 모아요
   - "S is a kind of ?" → `instance_of` 후보
   - "S is part of ?" → `part_of` 후보
   - "S depends on ?" → `depends_on` 후보
   - "S uses ?" → `uses` 후보
   - "S implements ?" → `implements` 후보
   - "S cites ?" → `cites` 후보
   - "S is same as ?" 또는 동의어 검색 → `same_as` 후보
   - "S supersedes ?" → `supersedes` 후보
4) 문자열 재확인(string search): `search_vault`로 실제 문서와 줄 번호를 확인해요.
5) 정규화(normalization): 대상 링크의 표제는 한국어 제목과 영문 병기를 유지해요. 예: `[[클라우드플레어(Cloudflare)]]`.
6) 선택과 제한(selection): 각 카테고리별로 신뢰도 높은 항목 위주로 1~5개 정도를 기록해 과다 연결을 피해요.
7) 정렬과 중복 제거(ordering, dedup): 사전식 정렬을 권장하고 중복·동의어는 `same_as`로 귀결해요.
8) 검증(validation): 아래 4.3 커버리지 매트릭스를 기준으로 누락을 점검해요.

### 4.3 엔티티별 권장 커버리지 매트릭스

- 개념(concept)
  - 필수: `instance_of: ['[[concept]]']`
  - 권장: `see_also`, `cites`
- 문서(document)
  - 필수: `part_of`
  - 권장: `cites`, 필요 시 `same_as`(중복 문서 병합), `supersedes`(신판 교체)
- 프로젝트(project, strategic)
  - 필수: `part_of`(상위 프로그램, 영역), `depends_on`(핵심 도구·플랫폼)
  - 권장: `implements`(참조 아키텍처, 표준), `uses`
- 절차(procedure, operational)
  - 필수: `implements`(파이프라인, 정책), `uses`(도구)
  - 권장: `cites`(참조 문서)
- 소프트웨어(software)·도구(tool)
  - 권장: `part_of`(에코시스템, 허브), `depends_on`(런타임, 프레임워크), `see_also`
- 데이터셋(dataset)
  - 권장: `part_of`(도메인), `depends_on`(스키마, 소스), `cites`(출처)

설명: 위 매트릭스는 최소 권장 관계를 안내해요. 도메인에 따라 추가 관계가 타당하면 4.1 범위 내에서 확장해요.

### 4.4 커버리지 체크리스트

- 분류가 기록되었나요 `instance_of`
- 상위 구성이 연결되었나요 `part_of`
- 외부 의존이 명시되었나요 `depends_on`
- 직접 사용하는 도구가 담겼나요 `uses`
- 어떤 사양을 구현하나요 `implements`
- 인용 근거가 남았나요 `cites`
- 동등 항목이나 대체 관계가 있나요 `same_as`, `supersedes`

### 4.5 작성 규칙

- 배열(array) 값으로 기록하고 한 줄에 한 항목만 적어요.
- 링크 표기는 위키 링크 형태 `[[경로|제목]]`를 권장해요. 표시는 제목만 보이도록 구성해요.
- README에 정의된 키만 사용해요. 새 키가 필요하면 README를 먼저 갱신해요.
- 예시 프론트매터

```
instance_of: ['[[guide]]']
part_of: ['[[WorldAce]]']
depends_on: ['[[Vite]]', '[[클라우드플레어(Cloudflare)]]']
uses: ['[[Obsidian]]']
implements: ['[[CI 파이프라인(CI Pipeline)]]']
cites: ['[[문헌 제목(Reference Title)]]']
same_as: []
supersedes: []
```

## 5. 명명과 자산 배치

- 파일명은 한글 제목 + 선택적 영문 병기를 사용해요. 예: `도메인 주도 설계(Domain-Driven Design).md`.
- 자산(asset)은 문서 인접 `assets/` 폴더에 두고 상대 경로(relative path)로 링크해요. 예: `20. Areas/50. AILSS/assets/diagram.png`.
- 경로나 파일 이동 후에는 `rg "\[\[" -n` 으로 끊긴 링크를 점검해요.

### 5.1 폴더 생성·명명 규칙

- 폴더 이름은 두 자리 숫자 프리픽스 + 공백 + 한글 제목 + 선택 영문 병기 형식으로 해요. 예: `12. 데이터 품질(Data Quality)`.
- 서브폴더도 동일 형식을 적용하고, 상위 폴더 기준 최대 3단계(depth 3)까지만 파생해요. 예: `12. 데이터 품질/20. 모니터링(Monitoring)`.
- 새 폴더 생성 시 `assets/` 서브폴더를 함께 만들고 자산은 상대 경로로만 임베드해요.
- 폴더 첫 문서는 허브 노트(hub note)로 만들고 파일명은 폴더명과 동일하게 해요. 프론트매터에 `entity: hub`, `layer: logical`, `instance_of: ['[[hub]]']`, `part_of: ['[[상위 폴더명]]']`를 넣어요.
- 폴더 이동·생성 후 `rg "\[\[" -n`으로 깨진 링크를 확인하고, 포함 노트의 `part_of`를 새 허브 노트로 업데이트해요.

## 6. 큐레이션과 PR 운영

- 캡처 → 정리 → 온톨로지 보강 순으로 커밋 단위를 구성해요.
- 한 커밋은 한 목적(one purpose)을 지켜요.
- 커밋 메시지는 명령형(imperative)으로 작성해요. 예: `add: conceptual/definition 초안`, `refactor: WorldAce 문서 layer 보정`.
- PR에는 변경 요약, 주요 노트 경로, 레이어·엔티티 변경 이유, 렌더링 차이 스크린샷(있다면)을 포함해요.
- 모든 노트 수정의 근거(rationale)는 채팅(chat)에서만 설명해요. 노트 본문에는 근거 섹션을 추가하지 않아요. 리뷰는 해당 채팅 설명을 기준으로 진행해요.

## 7. 빠른 판별 팁

- 파일·레포·버전·설정이 보이면 physical로 분류해요.
- 시간·이벤트(배포/회의/인시던트) 중심이면 operational로 분류해요.
- 도구 독립 개념·정의·원칙이면 conceptual로 분류해요.
- 도메인 엔티티·흐름·규칙 설계면 logical로 분류해요.
- 비전·로드맵·상위 결정이면 strategic으로 분류해요.

## 8. 볼트 구조 원칙과 폴더 역할

- `0. System` – 시스템 규칙, 템플릿, 스크립트, 운영 가이드 보관해요. 물리층(physical) 문서 중심이에요.
- `1. Main` – 최상위 허브(hub)·인덱스(index) 문서로 네비게이션 역할을 해요.
- `10. Projects` – 기간·범위가 있는 프로젝트(project) 산출물과 의사결정을 모아요. 전략층(strategic)·논리층(logical) 문서가 함께 있을 수 있어요.
- `20. Areas` – 장기 책임 영역(area) 지식과 운영 기준을 모아요. 개념층(conceptual)·운영층(operational) 혼합이 자연스러워요.
- `30. Resources` – 참고 자료(reference)·외부 문헌 요약을 모아요. 개념층 중심이에요.
- `40. Archives` – 휴면·종료 자료를 보관해요. 이동 시 원 경로를 `part_of`로 남겨요.
- `100. Inbox` – 캡처(capture) 임시 보관함이에요. 매일 `101. Need to Review`로 triage(분류)해요.
- `101. Need to Review` – 검토 대기 큐예요. 리뷰 후 최종 폴더로 이동해요.

### 구조 개선 규칙
- 프로젝트 하위의 과거 기록(OLD)은 `entity: document`, `layer: physical`로 일괄 표준화해요.
- 실행 로그·이벤트는 `entity: log|event`, `layer: operational`로 이동해요.
- 공통 원칙·정의·패턴은 `20. Areas` 또는 `30. Resources`로 승격하고 `entity: concept|definition|pattern`으로 정리해요.
- 파일 이동 후 `rg "\[\[" -n`으로 링크 깨짐을 즉시 점검해요.

## 9. 노트 논리 구조 가이드

모든 노트는 H1 헤더(header)부터 시작해요. 파일명(title)과 H1은 동일하게 유지해요.

### 공통 스켈레톤(skeleton)
- `# {제목}`
- `요약(summary)` – 3~5문장 핵심만 적어요.
- `맥락(context)` – 배경, 문제(problem), 범위(scope)를 적어요.
- `핵심 내용(core)` – 개념/설계/절차 본문을 적어요.
- `의사결정(decision)` – 결정사항, 대안, 근거를 표로 정리해요.
- `후속 작업(next actions)` – TODO 체크박스로 추적해요.
- `참고(reference)` – 출처, 관련 링크를 적어요.

### 엔티티별 최소 섹션
- 개념(concept): 정의(definition), 사례(examples), 반례(counterexamples), 관련 개념(see also)
- 프로젝트(project): 목표(objectives), 범위(scope), 산출물(artifacts), 타임라인(timeline), 리스크(risks)
- 절차(procedure): 전제(prereq), 단계(steps), 검증(criteria), 롤백(rollback)
- 결정(decide): 옵션(options), 평가(criteria), 선택(selection), 영향(impact)

## 10. Obsidian 문법 규칙

- 헤더(heading): ATX `#` 스타일만 사용해요. H1은 한 번만, H2~H4를 주로 사용해요.
- 목록(list): 글머리 기호 `-` 사용 통일해요. 서브 목록은 2스페이스 들여쓰기해요.
- 코드(code): 3 backticks 코드 펜스(code fence) 사용, 언어(lang) 표기해요.
- 표(table): 파이프(`|`) 표를 사용하고 헤더 행을 포함해요.
- 강조(emphasis): 의미 중심으로 `**굵게**`, `*기울임*`을 사용해요. 스타일 남용을 피해요.
- 콜아웃(callout): Obsidian 기본 `[!NOTE]`, `[!TIP]`, `[!WARNING]`만 사용해요.
- 이미지/파일 임베드(embed): `![[파일명]]` 사용, 자산은 인접 `assets/`에 둬요.
- 태그(tag): 맥락 탐색용 소수만 사용하고, 의미 관계는 프론트매터로 승격해요.
- 파일 이름: `한글 제목(영문 병기).md` 원칙을 지켜요.

## 11. 위키 링크·앵커·각주 규칙

- 위키 링크(wikilink): `[[노트명]]` 기본, 표기와 실제 파일명이 다르면 `[[노트명|표시명]]`을 사용해요.
- AGENTS.md 문서에서는 표시 텍스트(display text)로 제목을 명시해요. 항상 `[[경로|제목]]` 형식을 사용해 경로 대신 제목만 보이게 해요. 예: `[[20. Areas/30. SOPT/코드 리뷰/PROMPT|PROMPT]]`, `[[20. Areas/70. Claude Code/Commands/write-pr|write-pr]]`.
- 헤더 앵커(heading anchor): `[[노트명#섹션]]`을 사용하고, 섹션 이름 변경 시 링크도 함께 수정해요.
- 블록 참조(block reference): 인용이 필요한 최소 블록에 `^id`를 붙여 `[[노트명#^id]]`로 참조해요.
- 각주(footnote): 본문에 `[^키]`로 표기하고, 문서 하단에 `[^키]: 설명`으로 정의해요. 키는 의미 있는 짧은 영문·숫자를 사용해요.
- 링크 점검: 작업 전후 `rg "\[\[" -n`으로 깨진 링크를 확인해요.

## 12. Obsidian MCP 도구 사용(강한 지침)

 - 의무(Required): 요약(summarize), 분류(classify), 리뷰(review), 링크 점검 전 반드시 Obsidian MCP(옵시디언 MCP)로 볼트 메타를 조회해요.
- 원칙:
  - 읽기 우선(read-only)로 사용해요. 쓰기 작업은 별도 승인 후 진행해요.
  - 선행 질의: `search_vault`(전역 검색), `get_active_file`(현재 문서), `list_vault_files`(파일 목록)
  - 후속 질의: `get_vault_file`(본문/프론트매터 조회), `search_vault_smart`(의미 검색)
- 권장 흐름(flow):
  1) `search_vault`로 후보 문서를 수집해요.
  2) `get_vault_file`로 프론트매터와 본문을 확인해요.
  3) 타입 링크 후보를 의미론적으로 수집해요 `search_vault_smart` 기반 템플릿 쿼리 활용
     - "S is a kind of ?", "S is part of ?", "S depends on ?", "S uses ?", "S implements ?", "S cites ?"
  4) 문자열 검색으로 후보를 교차 검증해요 `search_vault` 줄 번호 확인
  5) 4장 커버리지 체크리스트로 누락을 보완하고 프론트매터에 반영해요
  6) 링크·자산 경로 점검을 수행해요
- 실패 대응: MCP 호출 실패 시 오류와 사유를 기록하고, 임시로 `rg`/`find`로 대체해요.

### 12.1 Obsidian MCP 도구 요약

- `search_vault`: 전역 문자열 검색(global text search)으로 기본 탐색에 사용하고, 키워드 두 개 이상과 `limit`를 함께 지정해 결과 범위를 신속히 줄여요.
- `search_vault_simple`: 패턴 반복 여부를 확인할 때 쓰고, 링크 점검이나 일괄 교정 직전에 실행해 누락된 구문을 모아요.
- `search_vault_smart`: 의미론적 검색(semantic search)으로 유사 맥락을 찾을 때 항상 병행 사용하고, 질문을 완전 문장 형태로 적어 재현성을 높여요.
- `list_vault_files`: 폴더 단위 변경이나 아카이브 작업 전 파일 분포를 확인해 우선순위를 조정해요.
- `get_active_file`: 현재 편집 중 문서의 프론트매터와 본문을 빠르게 확인해 실수 편집을 줄여요.
- `get_vault_file`: 특정 문서를 전체 맥락으로 검토해야 할 때 호출하고, 길이가 길면 필요한 섹션을 나눠 재호출해요.
- `get_server_info`: 연결 이상이 감지되면 즉시 호출해 인증 또는 상태 문제를 확인하고 보고해요.

### 12.2 의미론적 검색(semantic search) 지침

- **강한 지침(strong directive)**: 모든 조사·편집 의사결정은 `search_vault_smart` 실행으로 시작해요.
- 기본 규칙: 구조 검색(`search_vault`)과 의미 검색(`search_vault_smart`)을 항상 짝지어 실행해 문자 증거와 문맥 증거를 동시에 확보해요.
- 실행 흐름:
  1) 조사 목적을 한 문장으로 적고 동일 문장을 `search_vault_smart` 질의에 붙여 추후 재사용해요.
  2) `search_vault_smart` 상위 결과 두 개 이상을 우선 읽고, 동일 주제라도 서로 다른 폴더의 문서를 비교해 편향을 줄여요.
  3) 의미 검색에서 발견한 후보를 `search_vault`로 재확인해 정확한 위치와 줄 번호를 확보하고, 로그에 두 조회 결과를 함께 남겨요.
- 결정 전 검증: 의미 검색과 문자열 검색 결과가 모순되면 `get_vault_file` 또는 Fetch로 원문을 확인한 뒤 판단 이유를 기록해요.

## 13. 점검 체크리스트

- 작업 전: 관련 노트·자산 목록 확보(`search_vault`, `rg "assets/" -n`)
- 프론트매터: 필수 키(id, created, title, entity, layer, status) 확인
- 타입 링크: 4.4 체크리스트 항목(instance_of, part_of, depends_on, uses, implements, cites, same_as, supersedes) 전부 검토
- 커버리지 로그: 의미 검색과 문자열 검색 결과를 함께 기록
- 링크: `rg "\[\[" -n` 결과를 열고 미해결 링크를 수정
- 자산: 문서 인접 `assets/` 존재 여부 확인, 외부 경로 사용 금지
- 구조: H1=파일명, H2~H4 수준만 사용
- MCP: 요약·분류·리뷰 전 MCP 조회 로그 남김
- 완료 후: 변경 파일 경로와 레이어/엔티티 변경 이유를 기록
- 변경 근거: 채팅(chat)에서 근거 설명 완료를 확인해요.

## 14. 프론트매터 예시 템플릿

### 개념(concept) 노트
```
---
id: {{date:YYYYMMDDHHmmss}}
created: {{date:YYYY-MM-DDTHH:mm:ss}}
title: 도메인 주도 설계(Domain-Driven Design)
summary: 핵심 개념과 패턴 요약
aliases: [DDD]
entity: concept
layer: conceptual
tags: ['architecture']
status: draft
updated: {{date:YYYY-MM-DDTHH:mm:ss}}
source: ['책/블로그/논문 등']
instance_of: ['[[concept]]']
see_also: ['[[유비쿼터스 언어(Ubiquitous Language)]]']
---
```

### 프로젝트(project) 노트
```
---
id: {{date:YYYYMMDDHHmmss}}
created: {{date:YYYY-MM-DDTHH:mm:ss}}
title: WorldAce v2 로드맵(WorldAce v2 Roadmap)
summary: 분기 목표와 마일스톤 요약
entity: project
layer: strategic
status: in-review
updated: {{date:YYYY-MM-DDTHH:mm:ss}}
part_of: ['[[WorldAce]]']
depends_on: ['[[Vite]]', '[[Cloudflare]]']
---
```

### 절차(procedure) 노트
```
---
id: {{date:YYYYMMDDHHmmss}}
created: {{date:YYYY-MM-DDTHH:mm:ss}}
title: 배포 절차(Deployment Procedure)
summary: 스테이징→프로덕션 배포 단계와 검증 기준
entity: procedure
layer: operational
status: published
updated: {{date:YYYY-MM-DDTHH:mm:ss}}
implements: ['[[CI 파이프라인(CI Pipeline)]]']
---
```

## 15. 언어 및 표기 규칙

- 모든 문서는 한국어 `~해요`체로 작성해요.
- 기술 용어는 한영 병기해요. 예: 개념(concept), 프론트매터(front matter)
- 날짜/시간은 ISO-8601 형식으로 기록해요. 예: `2025-11-11T10:30:00`.
- 코드 주석은 한국어로 짧고 간결하게, 종결 어미 없이 작성해요.
- 중점(middle dot, ·) 금지: 제목, 본문, 목록, 표 등 문서 모든 영역에서 중점(·)을 사용하지 않아요. 구분이 필요하면 쉼표(,), 하이픈(-), en dash(–), 세미콜론(;) 또는 적절한 접속사로 대체해요.
