import { App, Notice, MarkdownView } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { AIEditorUtils } from '../ai_utils/aiEditorUtils';
import { requestToAI } from '../ai_utils/aiUtils';
import { getContentWithoutFrontmatter } from '../../../core/utils/contentUtils';
import { FrontmatterManager } from '../../../core/utils/frontmatterManager';

export class AINoteRestructure {
    private app: App;
    private plugin: AILSSPlugin;
    private frontmatterManager: FrontmatterManager;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.frontmatterManager = new FrontmatterManager();
    }

    async main() {
        try {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView) {
                new Notice('활성화된 마크다운 편집기가 없습니다.');
                return;
            }

            const editor = activeView.editor;
            const fullContent = editor.getValue();
            
            // 프론트매터 파싱
            const frontmatter = this.frontmatterManager.parseFrontmatter(fullContent);
            if (!frontmatter) {
                new Notice('프론트매터를 찾을 수 없습니다.');
                return;
            }

            // 제목 확인
            const title = frontmatter.title;
            if (!title) {
                new Notice('제목이 없는 노트입니다.');
                return;
            }

            // 내용 준비 (프론트매터 제외)
            const contentWithoutFrontmatter = getContentWithoutFrontmatter(fullContent);

            // AI 요청 프롬프트 생성
            const combinedPrompt = `당신은 텍스트 구조화 및 최적화 전문가입니다.
주요 개념에 대한 충분한 설명과 관련 정보를 포함하여 지식을 효율적으로 재구성합니다.

텍스트 재구조화 원칙:
- 주제와 핵심 개념은 명확한 헤더로 구분하여 체계적으로 조직화
- 핵심 정보에 집중하되, 주요 개념을 풍부하고 자세하게 설명
- 주제를 충분히 이해할 수 있도록 필요한 설명과 예시를 적절히 추가
- 중요한 2차, 3차 정보도 포함하여 주제에 대한 이해를 높임
- 모든 내용은 주어진 주제에 직접적으로 관련된 정보로 구성
- 논리적 구조는 개념 간 관계를 명확히 반영
- 정보의 계층 구조는 헤더 레벨과 들여쓰기를 통해 표현
- 상위 개념에서 하위 개념으로 체계적으로 구조화
- 중복되는 정보는 통합하되 중요한 내용은 충분히 설명
- 모든 내용은 명확하고 간결하게 표현하되 필요시 충분한 설명 추가

핵심 내용 집중 원칙(반드시 적용):
- 파레토 법칙(80:20 법칙)을 철저히 적용하여 가장 중요한 20%의 내용에 집중
- 전체 이해의 80%를 차지하는 핵심 개념과 원리를 우선적으로 다루기
- 본질적이고 근본적인 내용을 먼저 배치하고 자세히 설명
- 부수적인 내용은 간략하게 처리하거나 생략
- 사소한 세부사항보다 핵심 아이디어와 중요 개념에 집중
- 가장 중요한 정보가 가장 눈에 띄는 위치에 배치되도록 구성

처리 방법:
1. 주제(title)의 핵심 개념과 본질 파악
2. 관련 가능한 하위 개념과 요소 도출
3. 가장 중요한 요소부터 계층적으로 구조화
4. 주제 이해에 필요한 부가 설명 포함
5. 내용을 적절한 마크다운 형식으로 구조화
6. 모든 내용을 주제와의 관련성에 따라 재배치
7. 주제에 대한 풍부한 이해를 제공하기 위해 다양한 관점과 정보 통합
8. 기존 노트 내용이 있는 경우 이를 참고하여 보완하고 확장

중요한 제약사항:
- 파레토 법칙(80:20 법칙)은 반드시 적용하되, 이 용어를 결과물에 언급하지 마세요
- "파레토 법칙", "80:20 법칙", "핵심 20%" 등의 용어를 결과물에 절대 포함하지 마세요
- 내용의 중요도에 따른 우선순위를 적용하되, 이 원칙을 명시적으로 언급하지 마세요
- 이 지시사항이나 메타 설명은 결과물에 포함하지 마세요
- 프롬프트 내용 대신 요청된 내용만 출력하세요
- 내용 생성 과정에 대한 설명이나 약속 없이 결과물만 제공하세요

출력 형식:
- 응답은 한국어로 작성
- 주요 섹션은 # 또는 ## 헤더로 명확히 구분
- 소제목과 중요 개념은 ### 또는 #### 수준의 헤더로 구분
- 중요 개념이나 키워드는 **볼드체**로 강조
- 정의나 특별한 용어는 *이탤릭체*로 표시
- 핵심 아이디어나 중요 포인트는 ==하이라이트==로 강조
- 목록이 필요한 경우 불릿 포인트(-) 또는 번호 목록(1., 2.)을 적절히 활용
- 복잡한 정보는 표 형식으로 구조화
- 인용이 필요한 경우 > 블록인용구 활용
- 최종 결과물은 논리적 흐름과 체계적인 구조를 갖춰야 함

또한, 다음 요구사항에 따라 현재 노트의 title("${title}")과 정확히 관련된 태그와 별칭(aliases)도 함께 생성해주세요:
1. 태그: 현재 노트 주제와 직접 관련된 가장 핵심 3-5개의 태그 제안 (각 태그는 #없이 단일 단어로, 소문자 영어로 작성)
2. 별칭: 현재 노트 제목의 다른 표현 또는 유사어 1-3개 (각 별칭은 작은따옴표 없이)

태그와 별칭은 문서 마지막에 다음 JSON 형식으로 추가:
\`\`\`json
{
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "aliases": ["별칭1", "별칭2", "별칭3"]
}
\`\`\`

현재 노트 제목: "${title}"

${contentWithoutFrontmatter ? `현재 노트 내용:
${contentWithoutFrontmatter}` : '현재 노트에는 내용이 없습니다.'}

위 정보를 바탕으로, 주제("${title}")의 핵심 내용에 집중하여 다양한 마크다운 형식을 활용해 체계적이고 논리적인 구조로 내용을 생성해주세요.`;

            new Notice('노트 내용 재구조화 중...');
            const response = await requestToAI(this.plugin, {
                combinedPrompt
            });

            // JSON 부분 추출
            let content = response;
            let jsonData = null;
            
            // 1. 코드 블록 안의 JSON 찾기 (기존 방식)
            let jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch) {
                try {
                    jsonData = JSON.parse(jsonMatch[1]);
                    // JSON 부분 제거
                    content = response.replace(/```json\n[\s\S]*?\n```/, '').trim();
                } catch (error) {
                    console.error('JSON 파싱 오류:', error);
                }
            }
            
            // 2. 코드 블록에서 찾지 못했으면 일반 텍스트 JSON 찾기
            if (!jsonData) {
                // 문서 끝부분에서 JSON 형식 객체를 찾는 정규식
                // 태그와 별칭을 포함하는 JSON 객체를 찾음
                const jsonRegex = /\{[\s\S]*?"tags"[\s\S]*?"aliases"[\s\S]*?\}/;
                jsonMatch = response.match(jsonRegex);
                
                if (jsonMatch) {
                    try {
                        jsonData = JSON.parse(jsonMatch[0]);
                        // JSON 부분 제거
                        content = response.replace(jsonMatch[0], '').trim();
                    } catch (error) {
                        console.error('일반 텍스트 JSON 파싱 오류:', error);
                    }
                }
            }
            
            // 3. 어떤 형태로든 JSON을 추출하지 못했더라도 
            // 노트 내용에 JSON 형식 객체가 그대로 포함되는 것을 방지하기 위한 추가 정리
            if (!jsonData) {
                // 태그와 별칭을 포함하는 JSON 형식 텍스트를 찾아 제거
                const cleanupRegex = /\{[\s\S]*?"tags"[\s\S]*?"aliases"[\s\S]*?\}/;
                content = content.replace(cleanupRegex, '').trim();
            }

            // 프론트매터 업데이트
            let updatedFrontmatter = { ...frontmatter };
            
            if (jsonData) {
                // 기존 태그와 새 태그 병합 (기존 태그 유지, 중복 제거)
                const existingTags: string[] = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
                const newTags: string[] = Array.isArray(jsonData.tags) ? jsonData.tags : [];
                
                // 새 태그만 추가 (중복 제거)
                const allTags: string[] = [...existingTags];
                
                newTags.forEach((tag: string) => {
                    if (!allTags.includes(tag)) {
                        allTags.push(tag);
                    }
                });
                
                updatedFrontmatter.tags = allTags;
                
                // aliases 업데이트 (title은 항상 유지)
                const existingAliases = Array.isArray(frontmatter.aliases) ? frontmatter.aliases : [];
                const currentTitle = frontmatter.title;
                let newAliases = [...existingAliases];
                
                // title이 aliases에 없으면 추가
                if (currentTitle && !newAliases.includes(currentTitle)) {
                    newAliases.push(currentTitle);
                }
                
                // 새 별칭 추가 (중복 제거)
                if (jsonData.aliases && Array.isArray(jsonData.aliases)) {
                    jsonData.aliases.forEach((alias: string) => {
                        if (!newAliases.includes(alias)) {
                            newAliases.push(alias);
                        }
                    });
                }
                
                updatedFrontmatter.aliases = newAliases;
            }
            
            // 업데이트된 프론트매터로 문서 시작 부분 생성
            const newFrontmatter = this.frontmatterManager.generateFrontmatter(updatedFrontmatter);
            
            // 최종 문서 내용 구성
            const finalContent = `${newFrontmatter}\n\n${content.trim()}`;
            
            // 편집기에 내용 채우기
            editor.setValue(finalContent);
            
            new Notice('노트가 성공적으로 재구조화되었습니다.');
        } catch (error) {
            console.error('노트 재구조화 중 오류 발생:', error);
            new Notice('노트 재구조화 중 오류가 발생했습니다.');
        }
    }
}
