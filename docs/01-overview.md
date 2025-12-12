# 시스템 개요(overview)

이 문서는 AILSS를 “세 조각(3-part)”으로 나눠서 전체 흐름(flow)을 설명해요.

## 1) 인덱서(indexer)

역할:

- 볼트(vault)의 마크다운(markdown) 파일을 파일 시스템(file system)에서 읽어요.
- 청킹(chunking) 후 임베딩(embedding)을 생성해요.
- 메타데이터(metadata)와 함께 로컬 DB(예: SQLite)에 저장해요.

출력(예시):

- `chunk_id`, `path`, `heading`, `front matter`, `hash`, `embedding vector`, `text`

## 2) MCP 서버(server)

역할:

- 로컬 DB를 조회해서 검색/추천 결과를 제공해요.
- 기본은 읽기 중심(read-only) 도구(tool)로 시작해요.

도구(tool) 예시:

- `semantic_search`: 질의(query) → 관련 노트/청크 결과 반환
- `get_note`: 경로(path)로 노트 일부/메타데이터 반환
- `suggest_typed_links`: 타입드 링크(typed link) 후보 추천
- `find_broken_links`: 끊어진 링크(broken link) 탐지

## 3) Obsidian 플러그인(plugin)

역할:

- 추천 결과를 UI로 보여줘요.
- 사용자가 “적용(apply)” 버튼 등을 눌렀을 때만 실제 변경을 수행해요.
- 적용은 (A) 기존 스크립트(script) 호출 또는 (B) Obsidian Vault API로 직접 수정 중 하나로 구현해요.

## 데이터 경계(boundary)

- 인덱싱(indexing) = 파일 읽기(read) + DB 쓰기(write)
- 추천(recommendation) = DB 읽기(read)
- 적용(apply) = 파일 쓰기(write), 사용자 명시적 액션 필수

