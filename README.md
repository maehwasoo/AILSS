# AILSS (Indexer + MCP + Obsidian Plugin)

이 저장소(repo)는 Obsidian 볼트(vault) **AILSS**를 대상으로 아래 3가지를 만드는 코드 워크스페이스(workspace)예요.

1) 인덱서(indexer): 마크다운(markdown) → 청킹(chunking) → 임베딩(embedding) → 로컬 DB 저장  
2) MCP 서버(server): 읽기 중심 검색/추천 도구(tool) 제공  
3) Obsidian 플러그인(plugin): 추천 UI 표시 + 사용자의 명시적 액션으로 적용  

> 실제 Obsidian 볼트(vault) 데이터는 이 repo 밖에 있을 수 있어요. 이 repo는 “코드/설계 문서” 중심으로 관리해요.

## 문서

설계/맥락/계획 문서는 `docs/`에 정리해요.

- [docs/README.md](docs/README.md)
- [docs/00-context.md](docs/00-context.md)
- [docs/01-overview.md](docs/01-overview.md)
- [docs/02-significance.md](docs/02-significance.md)
- [docs/03-plan.md](docs/03-plan.md)

## 폴더 구조

초기 구조는 모노레포(monorepo) 형태로 `packages/` 아래에 패키지(package)를 분리해요.

- `packages/core/`: 공용 로직(파싱/청킹/스키마 등)
- `packages/indexer/`: 배치/증분 인덱싱 CLI
- `packages/mcp/`: MCP 서버(검색/추천)
- `packages/obsidian-plugin/`: Obsidian 플러그인(UI/적용)
