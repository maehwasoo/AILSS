# AILSS

---

## 프론트매터(스키마)

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
tags: [] # inbox 태그는 100. Inbox/ 아래 노트에만 사용 (예: ['inbox'])
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

---

### entity (interface | action | object)

- interface | pipeline | procedure | dashboard | checklist | workflow
- decide | review | plan | implement | approve | reject | observe | measure | test | verify | learn | research | summarize | publish | meet | audit | deploy | rollback | refactor | design | delete | update | create | schedule | migrate | analyze
- definition | concept | document | project | artifact | person | organization | place | event | task | method | tool | idea | principle | heuristic | pattern | definition | question | software | dataset | reference | hub | guide | log

---

### layer

- **strategic**  
   “왜 이걸 하지?”를 다룹니다. 비전·원칙·로드맵·OKR·아키텍처 결정 기록(ADR의 상위 맥락).
  - 예: “프런트엔드 번들링 전략 원칙”, “모노레포 채택 의사결정 배경”
- **conceptual**  
   “무엇인가?”를 다룹니다. 개념/정의/원리/패턴/용어. 프로젝트 무관, **보편 지식**.
  - 예: `Vite`가 무엇이며 어떤 문제를 푸는가
- **logical**  
   “어떻게 구조화할까?”를 다룹니다. 도메인 모델, 모듈 경계, 데이터 흐름, 프로토콜 설계(구현 독립).
  - 예: “빌드 파이프라인 단계(Logical)”, “패키지 구조 결정”
- **physical**  
   “무엇으로 구현할까?”를 다룹니다. 구체 기술/도구/리포/파일/설정.
  - 예: `vite.config.ts`, CI YAML, 패키지 버전 매트릭스
- **operational**  
   “실제 운용/변화는?”을 다룹니다. 배포·런북·모니터링·인시던트·실행 로그(주로 Action과 만남). - 예: “Sprint 3 배포 실행 결과”, 롤백 절차, 알람 튜닝 기록

  > 한 줄 테스트
  >
  > - 전략을 바꾸면 나머지 정의/설계/구현/운영이 바뀐다 → **strategic**
  > - 정의만 보아도 도구가 바뀌어도 성립한다 → **conceptual**
  > - 상위 구조/규칙만 있고 구체 기술은 없다 → **logical**
  > - 파일·레포·버전·설정이 보인다 → **physical**
  > - 시간·사건·운용 절차/결과가 핵심이다 → **operational**

- **strategic(왜)**: 비전/원칙/로드맵/상위 결정의 맥락
- **conceptual(무엇)**: 개념/정의/원리/패턴(도구 독립)
- **logical(어떻게 구조화)**: 아키텍처/모델/흐름/프로토콜(구현 독립)
- **physical(무엇으로 구현)**: 코드/설정/레포/버전/파일
- **operational(운영/관측)**: 런북/모니터링/인시던트/측정·관찰 로그

**한 줄 판별**

- 왜 바꾸면 전부 따라 바뀜 → **strategic**
- 도구 바뀌어도 유지되는 본질 → **conceptual**
- 구조/규칙만 있고 구현 미정 → **logical**
- 구체 파일·레포·버전 보임 → **physical**
- 시간/운영/관측/사건 중심 → **operational**

**엔티티→레이어 추천 매핑(예)**

- `concept/definition/pattern/principle/heuristic` → conceptual
- `method` → conceptual | logical
- `api-spec/model` → logical _(혹은 physical: 실제 스키마 파일인 경우)_
- `software/tool/dataset/artifact` → physical
- `guide/runbook/dashboard` → operational _(가이드가 절차·운영 중심일 때)_
- `decision/incident/log/event` → operational
- `project` → strategic | logical _(초기 방향/구조 문서의 성격 따라)_
  > _운용 팁_: 못 고르겠으면 **비워도 OK**. 기본값을 `conceptual`로 간주하거나, 리뷰 때만 채워도 충분합니다.

---

### typed links

- only forward relations; infer reverse relations via queries

```
instance_of:
part_of :
depends_on:
uses:
authored_by:
cites: # 인용, 출처
supersedes: # 대체
same_as:
implements:
see_also:
```

---

## 1) Interface 계열

| entity        | 기본 레이어     | 보조 레이어(상황별)   | 이유 한 줄                                                                      |
| ------------- | --------------- | --------------------- | ------------------------------------------------------------------------------- |
| **interface** | **logical**     | physical              | API/모듈의 ‘표면’(사양/계약)은 구조 정의가 핵심 → 논리. 실제 IDL/파일이면 물리. |
| **pipeline**  | **logical**     | physical, operational | 단계·흐름 설계가 본질. CI 설정(YAML)·러너면 물리, 실행/모니터링이면 운영.       |
| **procedure** | **operational** | —                     | 절차/런북 자체가 운영 행위 중심.                                                |
| **dashboard** | **operational** | physical              | 관측·알람·지표 보기 = 운영. 구현체(대시보드 JSON 등)면 물리.                    |
| **checklist** | **operational** | conceptual            | 실행 확인용 체크는 운영. 도구 불문 원칙·항목 템플릿이면 개념.                   |
| **workflow**  | **logical**     | operational           | 업무/프로세스 ‘구조’가 핵심 → 논리. 실제 인스턴스 실행·승인 흐름은 운영.        |
|               |                 |                       |                                                                                 |

---

## 2) Action 계열

| action        | 기본 레이어     | 보조 레이어(상황별) | 이유 한 줄                                                                |
| ------------- | --------------- | ------------------- | ------------------------------------------------------------------------- |
| **decide**    | **strategic**   | operational         | 상위 맥락/원칙/ADR 계열 결정이 핵심. 게이트 결재 행위면 운영.             |
| **review**    | **operational** | strategic, logical  | PR/문서/릴리스 리뷰 등 시간·행위 중심. 로드맵/아키 리뷰면 전략/논리.      |
| **plan**      | **strategic**   | operational         | 비전·로드맵·OKR 수립. 스프린트 캘린더 배치면 운영.                        |
| **implement** | **physical**    | operational         | 코드·설정·리포 단위의 구현. 구현 작업 추적은 운영.                        |
| **approve**   | **operational** | strategic           | 게이트 통과/결재는 이벤트 중심. 정책 차원의 승인 원칙이면 전략.           |
| **reject**    | **operational** | —                   | 승인/거부 이벤트.                                                         |
| **observe**   | **operational** | —                   | 모니터링/관찰 행위.                                                       |
| **measure**   | **operational** | conceptual          | 지표 수집·기록은 운영. 측정 정의(메트릭의 의미)는 개념.                   |
| **test**      | **operational** | physical, logical   | 테스트 실행/결과는 운영. 테스트 코드/스펙은 물리, 전략·전략은 논리.       |
| **verify**    | **operational** | —                   | 검증 행위/게이트.                                                         |
| **learn**     | **conceptual**  | operational         | 지식·교훈 정리(보편성). 회고 이벤트 자체는 운영.                          |
| **research**  | **conceptual**  | strategic           | 도구 독립 조사/탐색. 방향성 연구면 전략.                                  |
| **summarize** | **conceptual**  | operational         | 지식 정리 산출. 릴리스 노트 작성 등 이벤트에 묶이면 운영.                 |
| **publish**   | **operational** | physical            | 배포/공지/문서 공개 같은 실행 결과. 아티팩트 생성·업로드면 물리.          |
| **meet**      | **operational** | —                   | 일정 기반 회의(이벤트).                                                   |
| **audit**     | **operational** | strategic           | 점검/컴플라이언스 활동. 정책·기준 수립이면 전략.                          |
| **deploy**    | **operational** | physical            | 배포 실행/로그. 배포 스크립트/매니페스트는 물리.                          |
| **rollback**  | **operational** | physical            | 롤백 실행/결과. 롤백 스크립트/스냅샷은 물리.                              |
| **refactor**  | **physical**    | logical             | 코드/구성 변경이 물리. 리팩터링 규칙·구조 원칙은 논리.                    |
| **design**    | **logical**     | strategic, physical | 아키텍처·모델·흐름 설계. 원칙·비전 수준이면 전략, 산출물이 파일이면 물리. |
| **delete**    | **physical**    | operational         | 파일/데이터 삭제라는 구현 행위. 운영 절차(삭제 윈도우)면 운영.            |
| **update**    | **physical**    | operational         | 코드/설정/스키마 변경. 변경 관리 이벤트면 운영.                           |
| **create**    | **physical**    | operational         | 아티팩트/리소스 생성. 작업 트래킹은 운영.                                 |
| **schedule**  | **operational** | strategic           | 시간 배치/캘린더링. 장기 로드맵 편성은 전략.                              |
| **migrate**   | **operational** | physical            | 마이그레이션 실행/절차. 마이그레이션 스크립트/매핑은 물리.                |
| **analyze**   | **conceptual**  | operational         | 분석 자체는 도구 불문 통찰 생성. 운영 로그/사건 분석이면 운영.            |

---

## 3) Object 계열

| object           | 기본 레이어     | 보조 레이어(상황별)  | 이유 한 줄                                                                    |
| ---------------- | --------------- | -------------------- | ----------------------------------------------------------------------------- |
| **concept**      | **conceptual**  | —                    | 보편 개념/정의.                                                               |
| **document**     | **physical**    | conceptual           | 파일/위키/문서라는 구현물. 내용이 순수 정의라면 개념.                         |
| **project**      | **strategic**   | logical              | 방향·목표·스코프가 핵심. 초기 구조 문서면 논리.                               |
| **artifact**     | **physical**    | —                    | 빌드 결과물/산출물.                                                           |
| **person**       | **logical**     | operational          | 도메인 엔터티(모델)로서 사람. 실제 일정/행동 로그는 운영.                     |
| **organization** | **logical**     | strategic            | 도메인 엔터티. 거버넌스/정책 맥락이면 전략.                                   |
| **place**        | **logical**     | operational          | 도메인 엔터티. 이벤트 맥락(장소·일시) 붙으면 운영.                            |
| **event**        | **operational** | logical              | 시간·사건 중심(배포, 미팅, 인시던트). 이벤트 타입 정의는 논리.                |
| **task**         | **operational** | logical              | 실행 단위·백로그. 태스크 타입/상태모델은 논리.                                |
| **method**       | **conceptual**  | logical              | 절차·방법의 보편적 설명. 프로토콜·단계 구조화면 논리.                         |
| **tool**         | **physical**    | conceptual           | 특정 소프트웨어·서비스. 도구 무관 원칙 설명이면 개념.                         |
| **idea**         | **conceptual**  | —                    | 아이디어/영감은 도구 독립.                                                    |
| **principle**    | **conceptual**  | strategic            | 원칙·가이드라인. 상위 의사결정 문맥이면 전략.                                 |
| **heuristic**    | **conceptual**  | —                    | 경험칙/요령(보편).                                                            |
| **pattern**      | **conceptual**  | logical              | 재사용 구조 아이디어. 시스템에 투영되면 논리.                                 |
| **definition**   | **conceptual**  | —                    | 용어·정의.                                                                    |
| **question**     | **conceptual**  | —                    | 도구 독립 탐구 단위.                                                          |
| **software**     | **physical**    | —                    | 구체 소프트웨어/패키지/버전.                                                  |
| **dataset**      | **physical**    | —                    | 구체 데이터/스키마/버전.                                                      |
| **reference**    | **conceptual**  | physical             | 참고 지식(보편). 특정 문서/링크 파일 자체를 가리키면 물리.                    |
| **hub**          | **physical**    | logical              | 위키/포털/모노레포 등 구체 장소. 카테고리 구조 정의면 논리.                   |
| **guide**        | **operational** | conceptual           | 절차 중심 가이드/런북. 순수 원리 위주면 개념.                                 |
| **definition**   | **conceptual**  | -                    | 용어·개념의 **정의**는 도구 불문 보편 지식 → 개념층.                          |
| **log**          | **operational** | physical, logical    | 실행·운영에서 **발생/기록된 사실** → 운영층.                                  |
| **structure**    | logical         | physical, conceptual | 모듈/패키지/도메인 **배치·경계·관계**의 규칙을 정의 = 구현 독립 **구조 설계** |
| **architecture** | logical         | strategic, physical  | 시스템 **구성·흐름·경계**의 설계 자체 = 구현 독립 **논리**                    |

---

## 빠른 적용 팁

- **파일·리포·버전·설정이 보이면 → physical**
- **시간·이벤트(배포/회의/인시던트) 중심이면 → operational**
- **도구 독립 개념·정의·원칙이면 → conceptual**
- **도메인 엔터티/흐름/규칙 설계면 → logical**
- **비전·로드맵·상위 결정이면 → strategic**
