# 0001. 모노레포(monorepo)와 패키지 경계(packages)

status: accepted

## 맥락(context)

- AILSS는 인덱서(indexer), MCP 서버(server), Obsidian 플러그인(plugin)으로 역할이 갈라져요
- 공용 스키마(schema)와 로직(청킹, DB 등)은 공유하고 싶어요
- 동시에 배포/실행 환경은 분리하고 싶어요(특히 plugin vs server)

## 결정(decision)

- pnpm workspace 기반 모노레포(monorepo)로 시작해요
- `packages/core`, `packages/indexer`, `packages/mcp`, `packages/obsidian-plugin`로 경계를 고정해요
- 의존 방향은 `core <- (indexer, mcp)`로 제한해요

## 결과(consequences)

- 장점
  - 공용 코드 재사용이 쉬워요
  - 스키마 변경이 단일 repo에서 추적돼요
- 단점/리스크
  - repo가 커질 수 있어요
  - 패키지 경계 위반이 생기기 쉬워요(코드 리뷰로 방지)

## 대안(alternatives)

- indexer/mcp/plugin을 각각 별도 repo로 분리
  - 장점: 배포 단위가 명확
  - 단점: 공용 스키마/로직 중복, 동기화 비용 증가
