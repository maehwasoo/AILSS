import { App, Notice, Editor, MarkdownView } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { requestToAI } from '../ai_utils/aiUtils';
import { getContentWithoutFrontmatter } from '../../maintenance/utils/contentUtils';

export class AIAnswer {
    private app: App;
    private plugin: AILSSPlugin;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async main() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            new Notice('활성화된 마크다운 편집기가 없습니다.');
            return;
        }

        const editor = activeView.editor;
        const fullContent = getContentWithoutFrontmatter(editor.getValue());
        const selectedText = editor.getSelection();
        if (!selectedText) {
            new Notice('질문할 텍스트를 선택해주세요.');
            return;
        }

        // 선택된 텍스트의 위치 정보 저장
        const selections = editor.listSelections();
        const lastSelection = selections[selections.length - 1];
        const endPos = lastSelection.head.line > lastSelection.anchor.line ? 
            lastSelection.head : lastSelection.anchor;

        const systemPrompt = `당신은 학습자 중심의 지식 전문가이며 교육자입니다.
사용자의 질문에 대해 정확하고 포괄적이며 단계적으로 상세한 답변을 제공합니다.

답변 원칙:
- 정확성과 신뢰성을 절대적으로 우선시합니다
- 복잡한 개념은 기초부터 점진적으로 설명합니다
- 추상적 개념에는 실생활 예시와 비유를 활용합니다
- 다양한 관점과 견해를 균형있게 제시합니다
- 교육적 가치를 높이기 위해 질문 배경의 맥락을 고려합니다
- 답변은 명확한 논리적 구조와 흐름을 갖도록 구성합니다
- 불확실한 내용은 명시적으로 표현하고 가능한 여러 해석을 제시합니다
- 전문 용어는 한글과 원어를 함께 표기하고 간략한 설명을 추가합니다
- 질문자의 지식 수준에 맞춰 설명의 깊이를 조절합니다
- 후속 학습에 도움될 참고자료나 키워드를 제안합니다
- 답변 마지막에는 핵심 개념과 중요 포인트를 요약합니다

포맷팅 규칙:
- 모든 내용은 반드시 '- '로 시작하는 불릿 포인트 형식으로 작성합니다
- 들여쓰기는 반드시 띄어쓰기 4칸을 사용합니다
- 계층 구조는 주제-하위주제-세부내용 순으로 최대 3단계까지 구성합니다
- 단계별 설명도 불릿 포인트로 통일하고, 필요시 내용 안에 번호를 포함합니다
- 논리적 관계는 들여쓰기 단계를 통해 명확히 표현합니다
- 강조는 *텍스트*로 표시합니다
- 제목과 소제목은 ## 또는 ### 마크다운 형식으로 구분합니다
- 수식이나 코드는 \` 또는 \`\`\` 코드 블록으로 올바르게 포맷팅합니다
- 도식이 필요한 경우 ASCII 아트나 표를 활용합니다
- 지식의 계층적 구조화를 통해 이해도를 높입니다`;

        const userPrompt = `${systemPrompt}

다음은 전체 문서입니다:
${fullContent}

위 문서에서 다음 선택된 텍스트에 대해 문서의 맥락을 고려하여 상세하고 정확하게 답변해주세요:

선택된 텍스트:
${selectedText}`;

        try {
            new Notice('AI 답변 생성 중...');
            const response = await requestToAI(this.plugin, {
                userPrompt
            });

            // 저장된 위치 정보를 사용하여 답변 삽입
            editor.replaceRange(`\n${response}\n`,
                {line: endPos.line, ch: editor.getLine(endPos.line).length});
            new Notice('답변이 성공적으로 추가되었습니다.');
        } catch (error) {
            //console.error('AI 답변 생성 중 오류 발생:', error);
            new Notice('AI 답변 생성 중 오류가 발생했습니다.');
        }
    }
} 