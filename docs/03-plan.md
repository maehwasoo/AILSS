# 구현 계획(plan)

이 문서는 “작게 시작해서 확장”하는 구현 순서를 정리해요.

## 0) 전제/결정(Decision) 확정

- 지원 범위: 데스크톱(desktop) 우선인지, 모바일(mobile)까지인지 결정해요.
- 쓰기 범위: “추천만”인지, “파일 수정까지”인지 결정해요(기본은 추천만 권장해요).
- 볼트 경로: vault를 repo 내부에 둘지, 외부 경로를 설정으로 받을지 결정해요.

## 1) 인덱스 스키마(schema) 설계

- 파일 단위(file-level): `path`, `mtime`, `size`, `hash`
- 청크 단위(chunk-level): `chunk_id`, `start/end`, `heading`, `text`, `embedding`
- 링크(link): outgoing/incoming, 타입(type)

## 2) 인덱서(indexer) MVP

- 마크다운 파싱(parsing) + 헤딩(heading) 기반 청킹(chunking)
- 파일 해시(hash) 기반 증분 업데이트(incremental update)
- SQLite 저장(추후 벡터 인덱스(vector index) 추가)

## 3) MCP 서버(server) MVP

- `semantic_search`(topK) + `get_note` 제공
- 결과에 근거(explanation) 포함(청크 경로/헤딩/스니펫)

## 4) Obsidian 플러그인(plugin) MVP

- 추천 리스트 UI
- “적용(apply)” 버튼은 일단 비활성 또는 스크립트 호출로 한정

## 5) 통합/운영

- 로컬 설정(config) 정리(API 키, vault 경로)
- 프라이버시(privacy) 문서화 및 옵트인(opt-in) 옵션

