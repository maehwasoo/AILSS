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

    // 별칭이 있는 옵시디언 링크 패턴을 찾는 정규식 - [[타임스탬프|별칭]] 형식만 처리
    private readonly ALIASED_LINK_PATTERN = /\[\[(.*?)\|(.*?)\]\]/g;

    // 텍스트에서 링크를 추출하는 함수
    private extractLinks(text: string): {original: string, timestamp: string, alias: string}[] {
        const links: {original: string, timestamp: string, alias: string}[] = [];
        let match;
        
        // 별칭이 있는 링크만 찾기
        while ((match = this.ALIASED_LINK_PATTERN.exec(text)) !== null) {
            links.push({
                original: match[0],
                timestamp: match[1],
                alias: match[2]
            });
        }
        
        return links;
    }

    // AI에게 보낼 텍스트에서 링크를 마스킹하는 함수
    private maskLinks(text: string, links: {original: string, timestamp: string, alias: string}[]): string {
        let maskedText = text;
        links.forEach((link, index) => {
            maskedText = maskedText.replace(link.original, `[LINK_${index}]`);
        });
        return maskedText;
    }

    // 마스킹된 링크를 원래 형태로 복원하는 함수
    private restoreLinks(text: string, links: {original: string, timestamp: string, alias: string}[]): string {
        let restoredText = text;
        links.forEach((link, index) => {
            // 원본 링크를 다시 삽입
            restoredText = restoredText.replace(`[LINK_${index}]`, link.original);
        });
        return restoredText;
    }

    async main() {
        try {
            const editor = AIEditorUtils.getActiveEditor(this.app);
            const selectedText = editor.getSelection();
            
            if (!selectedText) {
                new Notice('텍스트를 선택해주세요.');
                return;
            }

            // 선택된 텍스트에서 링크 추출
            const links = this.extractLinks(selectedText);
            
            // 링크를 마스킹한 텍스트 생성
            const maskedText = this.maskLinks(selectedText, links);

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
            
            핵심 내용 집중 원칙(반드시 적용):
            - 파레토 법칙(80:20 법칙)을 철저히 적용하여 가장 중요한 20%의 내용에 집중
            - 전체 이해의 80%를 차지하는 핵심 개념과 원리를 우선적으로 다루기
            - 본질적이고 근본적인 내용을 먼저 배치하고 자세히 설명
            - 부수적인 내용은 간략하게 처리하거나 생략
            - 사소한 세부사항보다 핵심 아이디어와 중요 개념에 집중
            - 가장 중요한 정보가 가장 눈에 띄는 위치에 배치되도록 구성
            
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
            
            링크 처리 규칙:
            - 텍스트 내 [LINK_숫자] 형식의 마커는 절대 변경하거나 제거하지 않습니다
            - 모든 [LINK_숫자] 마커는 원래 위치에 그대로 유지합니다
            - [LINK_숫자] 마커의 번호와 형식을 정확히 보존합니다
            - [LINK_숫자] 마커의 문맥과 의미를 고려하여 적절한 위치에 배치합니다
            - 마커 주변의 문맥이 변경되더라도 마커 자체는 그대로 유지합니다
            
            처리 과정:
            1. 입력 텍스트의 전체 구조와 논리적 흐름 분석
            2. 주요 섹션과 하위 내용 식별 및 계층 관계 파악
            3. 일관된 구조화 규칙 적용하여 전체 내용 재구성
            4. 중복 제거 및 관련 정보 그룹화
            5. 최종 계층 구조 검증 및 일관성 확인
            6. 지식 간 연결성 강화 및 논리적 흐름 최적화
            7. [LINK_숫자] 마커를 원래 위치에 유지하며 내용 정리
            
            중요: 
            - 파레토 법칙(80:20 법칙)은 반드시 적용하되, 이 용어를 결과물에 언급하지 마세요
            - "파레토 법칙", "80:20", "핵심 20%" 같은 표현은 결과물에 포함하지 마세요
            - 내용의 중요도에 따른 우선순위를 적용하되, 이 원칙을 명시적으로 언급하지 마세요
            - 이 지시사항이나 메타 설명은 결과물에 절대 포함하지 마세요
            - 구조화 원칙과 포맷팅 규칙은 참고만 하고 실제 결과물에는 내용만 포함하세요
            - 변환 과정이나 접근 방식에 대한 설명 없이 결과만 출력하세요
            - [LINK_숫자] 형식의 마커는 절대 변경하거나 제거하지 마세요`;

            const userPrompt = `${systemPrompt}

다음 텍스트를 위 규칙에 따라 재구성해주세요:

"${maskedText}"

변환 규칙:
- 파레토 법칙(80:20 법칙)을 철저히 적용하여 핵심 20%에 집중하되, 이 원칙 자체는 언급하지 말 것
- 주요 섹션은 # 또는 ## 헤더로 명확히 구분
- 소제목과 중요 개념은 ### 또는 #### 수준의 헤더로 구분
- 중요 개념이나 키워드는 **볼드체**로 강조
- 정의나 특별한 용어는 *이탤릭체*로 표시
- 핵심 아이디어나 중요 포인트는 ==하이라이트==로 강조
- 목록이 필요한 경우 불릿 포인트(-) 또는 번호 목록(1., 2.)을 적절히 활용
- 복잡한 정보는 표 형식으로 구조화
- 인용이 필요한 경우 > 블록인용구 활용
- 내용의 논리적 구조를 유지하고 강화
- "파레토 법칙", "80:20", "핵심 20%" 같은 메타 표현 사용하지 않기
- 변환 과정 설명이나 지시사항 없이 결과만 출력
- [LINK_숫자] 형식의 마커는 원래 위치에 정확히 유지할 것`;

            new Notice('텍스트 재구성 중...');
            const response = await requestToAI(this.plugin, {
                userPrompt
            });
            
            // AI 응답에서 링크 복원
            const restoredText = this.restoreLinks(response, links);
            
            await AIEditorUtils.insertAfterSelection(editor, restoredText);
            new Notice('텍스트가 성공적으로 재구성되었습니다.');
        } catch (error) {
            new Notice('텍스트 재구성 중 오류가 발생했습니다.');
        }
    }
}
