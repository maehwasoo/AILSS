# 아키텍처(architecture): 패키지 구조(packages)

이 문서는 현재 repo의 패키지(package) 구조와 경계(boundary)를 고정해요.

## 모노레포(monorepo) 개요

- 패키지 매니저(package manager): pnpm workspace
- 상위 디렉터리: `packages/*`

## 패키지 구성

### `packages/core` (`@ailss/core`)

역할:

- vault 파일 시스템(file system) 접근 유틸
- 마크다운(markdown) 파싱/청킹(chunking)
- SQLite DB 스키마/쿼리(벡터 검색 포함)
- 환경변수(environment variable) 로딩

주의:

- 다른 패키지에 의존하지 않아요(최하위 레이어)

### `packages/indexer` (`@ailss/indexer`)

역할:

- vault를 스캔(scan)해서 변경된 파일만 증분 인덱싱(incremental indexing)
- OpenAI embeddings API로 임베딩(embedding) 생성
- DB에 파일/청크/임베딩 저장

엔트리(entry):

- `packages/indexer/src/cli.ts` (`ailss-indexer`)

### `packages/mcp` (`@ailss/mcp`)

역할:

- 로컬 DB를 기반으로 검색/조회 도구(tool) 제공
- 기본 transport는 STDIO로 시작해요(Codex CLI 연동 목적)

엔트리(entry):

- `packages/mcp/src/stdio.ts` (`ailss-mcp`)

### `packages/obsidian-plugin`

역할(예정):

- 추천 결과 UI 표시
- 사용자의 명시적 액션(action)으로 적용(apply) 수행

## 의존 방향(dependency direction)

```
core  <-  indexer
core  <-  mcp
plugin (별도, 추후 연결)
```

## 설정(config) 원칙

- vault 경로(vault path)는 외부 설정으로 받아요
- 로컬 DB는 기본적으로 `<vault>/.ailss/index.sqlite`를 사용해요

