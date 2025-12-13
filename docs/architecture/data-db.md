# 아키텍처(architecture): 데이터/DB(data & database)

이 문서는 인덱스 DB 스키마(schema)와 인덱싱/검색 흐름을 정리해요.

## DB 위치

- 기본값: `<vault>/.ailss/index.sqlite`
- 생성 로직: `@ailss/core`의 `resolveDefaultDbPath(vaultPath)`

## DB 구성 요소

### files 테이블

파일 단위(file-level) 메타데이터를 저장해요.

- `path` (PK): vault 기준 상대 경로(relative path)
- `mtime_ms`, `size_bytes`
- `sha256`: 파일 내용 해시(hash)

### chunks 테이블

청크(chunk) 단위 텍스트와 메타데이터를 저장해요.

- `chunk_id` (PK)
- `path` (FK → files.path)
- `heading`, `heading_path_json`
- `content`, `content_sha256`

### chunk_embeddings(vec0)

벡터 검색(vector search)을 위한 sqlite-vec `vec0` 가상 테이블(virtual table)이에요.

- `embedding FLOAT[dim]`

### chunk_rowids

`chunks.chunk_id`와 `chunk_embeddings.rowid` 매핑을 저장해요.

## 인덱싱 흐름(indexing flow)

1. vault 내 `.md` 파일 목록을 스캔해요(기본 ignore: `.obsidian`, `.git`, `.trash`, `.ailss` 등)
2. 파일 내용 sha256이 DB의 기존 값과 다르면 “변경됨”으로 판단해요
3. `files`를 upsert하고, 해당 파일의 기존 `chunks`/`chunk_rowids`/`chunk_embeddings`를 정리해요
4. 마크다운 본문을 heading 기반으로 청킹(chunking)해요(`maxChars` 적용)
5. OpenAI embeddings API로 청크 임베딩(embedding)을 생성해요(배치 호출)
6. `chunks`, `chunk_embeddings`, `chunk_rowids`를 삽입해요

## 검색 흐름(search flow)

- `semantic_search`는 질의(query) 임베딩을 만들고, sqlite-vec `MATCH` + `k = ?`로 KNN 검색을 수행해요
- sqlite-vec 제약상 KNN 쿼리는 `k = ?` 또는 `LIMIT`이 필요해서, CTE(공통 테이블 표현식)로 매치를 분리해요

## 차원(dimension) 주의

- 임베딩 모델(model)에 따라 차원(dimension)이 달라요
- DB의 `chunk_embeddings`는 생성 시점에 차원을 고정하므로, 모델을 바꾸면 DB 재생성이 필요할 수 있어요
