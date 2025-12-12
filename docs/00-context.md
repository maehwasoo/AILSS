# 지금 맥락(context)

이 문서는 “왜 이 repo가 생겼는지”와 “무엇을 만들려는지”의 현재 맥락을 고정해요.

## 배경

- 대상: Obsidian 볼트(vault) **AILSS**
- 목표: OpenAI API로 문서 임베딩(embedding)을 생성해 벡터 검색(semantic search)을 하고, README/AGENTS 규칙에 맞춰 정리/추천/적용까지 연결해요.
- 노출: MCP(Model Context Protocol) 서버로 도구(tool)를 제공해서 Codex CLI에서 바로 호출할 수 있게 해요.
- UI: Obsidian 플러그인(plugin)에서도 추천을 보고, 사용자의 명시적 액션(action)으로 적용할 수 있게 해요.

## 현재 상태(설명 기준)

아래는 “사용자 제공 설명” 기준으로 기록해요(이 repo에서 자동으로 검증한 사실이 아니에요).

- 볼트 루트에 `README.md`(프론트매터(front matter) 스키마/레이어(layer)/타입드 링크(typed link) 정의)와 `AGENTS.md`(작업 규칙)가 있어요.
- `0. System/Scripts`에 Obsidian Local REST API 기반 자동화 스크립트들이 이미 있어요(예: 프론트매터 삽입, 배치 적용 등).

이 repo에서는 규칙 원문을 참고용으로 `docs/vault-ref/`에 스냅샷(snapshot)으로 보관해요.

## 이 repo의 역할

이 폴더(`…/AILSS`)는 Obsidian 볼트 자체가 아니라, 아래 코드를 개발/유지하기 위한 워크스페이스(workspace)예요.

- 인덱서(indexer) 코드
- MCP 서버(server) 코드
- Obsidian 플러그인(plugin) 코드
- 설계/운영 문서

## 범위(scope) 원칙

- 기본 원칙: “추천은 읽기(read) 중심”, “실제 반영(write)은 명시적 실행”으로 분리해요.
- 안전: 노트 내용 외부 전송(privacy)과 API 키(key) 보관은 설계 단계에서 명시적으로 다뤄요.
