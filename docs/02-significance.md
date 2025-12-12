# 의의(significance)와 원칙(principles)

이 문서는 “왜 이렇게 나누는지(인덱서/서버/플러그인)”와 “무엇을 지키는지”를 정리해요.

## 의의

- 검색 품질: 키워드 검색(keyword search) 대신 의미 기반(semantic)으로 찾아요.
- 정리 자동화: 프론트매터(front matter)와 링크(link)를 규칙 기반으로 일관되게 유지해요.
- 작업 안전: 추천과 적용을 분리해서 실수/오작동 리스크(risk)를 줄여요.
- 재사용성: Codex CLI(MCP)와 Obsidian UI에서 같은 추천 엔진을 공유해요.

## 원칙

- 최소 권한(least privilege): MCP 서버는 기본적으로 읽기(read)만 해요.
- 명시적 적용(explicit apply): 파일 변경(write)은 사용자 액션으로만 해요.
- 추적 가능성(traceability): 추천 근거(어떤 청크/어떤 규칙)를 결과에 포함해요.
- 프라이버시(privacy): 외부 전송 범위/옵션을 문서화하고 설정으로 통제해요.

