import { App, Notice } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { AIEditorUtils } from '../ai_utils/aiEditorUtils';
import { requestToAI } from '../ai_utils/aiUtils';

export class AILatexMath {
    private app: App;
    private plugin: AILSSPlugin;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async main() {
        try {
            const editor = AIEditorUtils.getActiveEditor(this.app);
            const selectedText = editor.getSelection();
            
            if (!selectedText) {
                new Notice('텍스트를 선택해주세요.');
                return;
            }

            const combinedPrompt = `당신은 수학, 물리학, 컴퓨터 과학 분야의 LaTeX 전문가입니다. 
            자연어로 표현된 수식과 수학적 표현을 정확하고 효율적인 LaTeX 코드로 변환하는 능력이 탁월합니다.
            
            전문 분야:
            - 고급 수학 표기법 (미적분학, 선형대수학, 해석학, 위상수학, 확률론 등)
            - 물리학 공식 및 방정식 (양자역학, 상대성이론, 전자기학, 통계역학 등)
            - 컴퓨터 과학 알고리즘 및 의사코드
            - 통계 분석 및 데이터 시각화 표현
            - 기계학습 및 인공지능 관련 수식
            
            변환 원칙:
            - 수학적 정확성을 절대적으로 우선시
            - 모든 특수 기호는 정확한 LaTeX 명령어 사용
            - 수식 구조의 명확한 계층화 및 그룹화
            - 가독성과 유지보수성을 고려한 코드 구성
            - 일관된 스타일과 표기법 적용
            
            LaTeX 최적화 기법:
            - 복잡한 수식은 align, gather, cases 등 적절한 환경 사용
            - 반복되는 표현은 newcommand로 정의하여 재사용성 높임
            - 행렬, 벡터, 텐서는 최적의 환경 선택 (matrix, bmatrix, pmatrix 등)
            - 분수, 적분, 극한, 시그마 표현을 명확하게 구성
            - 첨자와 윗첨자의 정확한 배치
            - 괄호 크기 자동 조정을 위한 left, right 명령어 활용
            
            한글 및 텍스트 처리:
            - 모든 일반 텍스트는 \\text{} 안에 배치
            - 한글 텍스트도 \\text{} 명령어로 처리
            - 영문 변수는 이탤릭체로 수식 모드에서 처리
            - 수식 내 함수명(sin, log 등)은 \\operatorname 또는 내장 명령어 사용

다음 표현을 LaTeX 코드로 변환해주세요:

            "${selectedText}"

            변환 규칙:
            1. Obsidian에서 인식 가능한 LaTeX 문법 사용
            2. $$ ... $$ 형식으로 감싸기
            3. 변환 과정 설명 없이 코드만 출력
            4. 필요시 줄바꿈과 align 환경 사용
            5. 왼쪽 정렬 유지
            6. 가독성을 위한 적절한 줄바꿈 추가
            7. 필요시 \\begin{...} ... \\end{...} 형식 사용
            8. 일반 텍스트는 \\text{} 안에 넣어 처리
            9. 영문 변수나 수식 기호는 수식 모드로 처리
            10. 한글 텍스트는 \\text{} 안에 넣어 처리
            11. 복잡한 수식은 적절히 구조화하여 가독성 높이기`;

            new Notice('LaTeX 수학 코드 생성 중...');
            const response = await requestToAI(this.plugin, {
                combinedPrompt
            });
            
            await AIEditorUtils.insertAfterSelection(editor, response);
            new Notice('LaTeX 수학 코드가 성공적으로 생성되었습니다.');
        } catch (error) {
            //console.error('LaTeX 수학 코드 생성 중 오류 발생:', error);
            new Notice('LaTeX 수학 코드 생성 중 오류가 발생했습니다.');
        }
    }
}
