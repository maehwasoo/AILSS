import { App, Notice } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { AIEditorUtils } from '../ai_utils/aiEditorUtils';
import { requestToAI } from '../ai_utils/aiUtils';

export class AIReformat {
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

            const systemPrompt = `당신은 텍스트 포맷팅과 정보 구조화의 최고 전문가입니다.
            주어진 텍스트를 체계적이고 일관된 계층적 구조로 완벽하게 재구성합니다.
            
            구조화 원칙:
            - 내용은 의미적 계층에 따라 논리적으로 구조화
            - 주요 섹션은 헤더(#, ##, ###)를 사용해 명확히 구분
            - 관련 개념들은 적절한 그룹으로 묶어 구조화
            - 주제와 하위 주제의 관계를 명확히 표현
            - 중복 정보 제거 및 통합
            - 핵심 정보 우선 배치
            - 개념 간 연결성과 인과관계 명확히 표현
            
            포맷팅 규칙:
            - 주요 섹션은 # 또는 ## 수준의 헤더로 구분
            - 소제목과 중요 개념은 ### 또는 #### 헤더로 표시
            - 중요 개념이나 키워드는 **볼드체**로 강조
            - 정의나 특별한 용어는 *이탤릭체*로 표시
            - 핵심 아이디어나 중요 포인트는 ==하이라이트==로 강조
            - 목록이 필요한 경우 불릿 포인트(-) 또는 번호 목록(1., 2.)을 적절히 활용
            - 표가 필요한 경우 마크다운 표 형식 사용
            - 인용이 필요한 경우 > 블록인용구 활용
            - 코드나 수식은 \`코드\` 또는 코드 블록으로 표시
            - 시각적 계층 구조를 통해 정보의 논리적 흐름을 강화
            
            처리 과정:
            1. 입력 텍스트의 전체 구조와 논리적 흐름 분석
            2. 주요 섹션과 하위 내용 식별 및 계층 관계 파악
            3. 일관된 구조화 규칙 적용하여 전체 내용 재구성
            4. 중복 제거 및 관련 정보 그룹화
            5. 최종 계층 구조 검증 및 일관성 확인
            6. 지식 간 연결성 강화 및 논리적 흐름 최적화`;

            const userPrompt = `${systemPrompt}

다음 텍스트를 위 규칙에 따라 재구성해주세요:

"${selectedText}"

변환 규칙:
- 주요 섹션은 # 또는 ## 헤더로 명확히 구분
- 소제목과 중요 개념은 ### 또는 #### 수준의 헤더로 구분
- 중요 개념이나 키워드는 **볼드체**로 강조
- 정의나 특별한 용어는 *이탤릭체*로 표시
- 핵심 아이디어나 중요 포인트는 ==하이라이트==로 강조
- 목록이 필요한 경우 불릿 포인트(-) 또는 번호 목록(1., 2.)을 적절히 활용
- 복잡한 정보는 표 형식으로 구조화
- 인용이 필요한 경우 > 블록인용구 활용
- 내용의 논리적 구조를 유지하고 강화
- 변환 과정 설명 없이 결과만 출력`;

            new Notice('텍스트 재구성 중...');
            const response = await requestToAI(this.plugin, {
                userPrompt
            });
            
            await AIEditorUtils.insertAfterSelection(editor, response);
            new Notice('텍스트가 성공적으로 재구성되었습니다.');
        } catch (error) {
            new Notice('텍스트 재구성 중 오류가 발생했습니다.');
        }
    }
}
