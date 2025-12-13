# 0002. 데스크톱 우선(isDesktopOnly) + 로컬 DB(SQLite + sqlite-vec)

status: accepted

## 맥락(context)

- 초기 목표는 Codex CLI에서 MCP 도구(tool)로 바로 검색을 쓰는 거예요
- 모바일(mobile)까지 지원하면 플러그인 제약이 커지고(특히 네이티브 모듈), 초기 개발 속도가 크게 떨어져요
- 벡터 검색(vector search)은 로컬에서 빠르고 재현 가능해야 해요

## 결정(decision)

- 1차는 데스크톱(desktop) 전용(isDesktopOnly) 전제로 설계해요
- vault 경로(vault path)는 repo 내부가 아니라 외부 설정으로 받아요(`AILSS_VAULT_PATH`)
- 인덱스 저장소(vector store)는 로컬 SQLite로 두고, 벡터 검색은 sqlite-vec을 사용해요
- API 키(key)는 로컬 `.env`로만 관리해요(커밋 금지)

## 결과(consequences)

- 장점
  - 빠르게 MVP를 만들 수 있어요
  - 데이터가 로컬에 머물러 프라이버시(privacy) 위험을 줄여요
- 단점/리스크
  - 모바일 지원은 추후 별도 아키텍처(서버/동기화) 검토가 필요해요
  - 네이티브 모듈(better-sqlite3) 빌드 환경 이슈가 있을 수 있어요

## 대안(alternatives)

- 원격 벡터 DB(예: hosted vector DB)
  - 장점: 배포/공유 쉬움
  - 단점: 프라이버시/비용/운영 부담 증가
