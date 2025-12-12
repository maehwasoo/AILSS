# Vault 규칙 원문(vault-ref)

이 폴더는 Obsidian AILSS 볼트(vault)의 **규칙 원문(source of truth)**을 이 repo에서 참고(reference)하기 위해 보관하는 공간이에요.

## 목적

- 이 repo(코드/설계)에서 볼트 규칙(프런트매터(front matter), 온톨로지(ontology), 작업 규칙)을 쉽게 참조해요.
- 구현 스펙(spec)과 “원문 규칙”을 분리해서 드리프트(drift, 불일치)를 줄여요.

## 원문 배치 위치

아래 경로에 vault 루트의 파일을 그대로 복사해 넣어주세요(가능하면 내용 수정 없이 유지해요).

- `docs/vault-ref/vault-root/README.md`
- `docs/vault-ref/vault-root/AGENTS.md`

> 이 repo에는 Obsidian vault 전체를 넣지 않아요. “규칙 원문 2개”만 최소로 스냅샷(snapshot)하는 방식이 기본이에요.

## 동기화(sync) 규칙

- 원본은 항상 vault 쪽이에요: `~/Obsidian/AILSS/README.md`, `~/Obsidian/AILSS/AGENTS.md`
- 이 폴더의 파일은 “참고용 스냅샷”이에요.
- 업데이트할 때는 “원문 그대로 복사 → git diff로 변경점 확인 → 필요한 구현 스펙(spec) 반영” 순서로 진행해요.

