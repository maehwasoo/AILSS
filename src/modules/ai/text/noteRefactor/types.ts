import { App, TFile } from 'obsidian';
import AILSSPlugin from '../../../../../main';

// 포맷팅 규칙 상수 (다른 AI 모듈에서 공통으로 사용하는 규칙)
export const FORMATTING_RULES = `
포맷팅 규칙:
- 주요 섹션은 # 또는 ## 헤더로 명확히 구분
- 소제목과 중요 개념은 ### 또는 #### 수준의 헤더로 구분
- 중요 개념이나 키워드는 **볼드체**로 강조
- 정의나 특별한 용어는 *이탤릭체*로 표시
- 핵심 아이디어나 중요 포인트는 ==하이라이트==로 강조
- 목록이 필요한 경우 불릿 포인트(-) 또는 번호 목록(1., 2.)을 적절히 활용
- 복잡한 정보는 표 형식으로 구조화
- 인용이 필요한 경우 > 블록인용구 활용`;

// 공통 인터페이스 정의
export interface NoteResult {
    file: TFile;
    title: string;
    originalContent: string;
    newContent: string;
    frontmatter: Record<string, any>;
}

export interface NoteInfo {
    file: TFile;
    title: string;
    content: string;
    frontmatter: Record<string, any>;
}

export interface SplitResult {
    originalFile: NoteResult;
    newNotes: Array<{
        title: string;
        content: string;
        frontmatter: Record<string, any>;
    }>;
}

export interface CoreDependencies {
    app: App;
    plugin: AILSSPlugin;
}