# 로컬 개발(local development)

이 문서는 로컬에서 인덱서(indexer)와 MCP 서버(server)를 실행하는 방법을 정리해요.

## 1) 환경변수 준비

`.env.example`을 참고해 repo 루트에 `.env`를 만들고 아래를 채워요.

- `OPENAI_API_KEY`
- `AILSS_VAULT_PATH` (절대 경로)
- `OPENAI_EMBEDDING_MODEL` (선택, 기본 `text-embedding-3-small`)

## 2) 설치/빌드

> 이 프로젝트는 `better-sqlite3` 네이티브 모듈 빌드가 필요할 수 있어요.  
> 샌드박스/CI 환경에서는 기본 캐시 경로가 막힐 수 있어서, 캐시를 workspace 내부로 고정해요.

```bash
CI=0 npm_config_cache="$PWD/.npm-cache" npm_config_devdir="$PWD/.node-gyp" pnpm install --no-frozen-lockfile
pnpm build
```

## 3) 인덱싱(indexing) 실행

```bash
pnpm -C packages/indexer start -- --vault "$AILSS_VAULT_PATH"
```

옵션:

- `--max-chars 4000`: 청크 최대 길이
- `--batch-size 32`: 임베딩 배치 크기

## 4) MCP 서버(server) 실행 (STDIO)

```bash
pnpm -C packages/mcp start
```

필수:

- `OPENAI_API_KEY`(질의 임베딩 생성)
- `AILSS_VAULT_PATH`(기본 DB 경로 계산, get_note 파일 읽기)

## 5) 품질 체크(quality gate)

개발 중에는 아래 커맨드(command)를 자주 쓰는 것을 권장해요.

- 전체 체크: `pnpm check`
- 포맷: `pnpm format` / `pnpm format:check`
- 린트: `pnpm lint` / `pnpm lint:fix`
- 테스트: `pnpm test`

Git 훅(hook)은 Lefthook으로 자동 설치돼요(`pnpm install` 시). 상세는 `docs/standards/quality-gates.md`를 참고해요.
