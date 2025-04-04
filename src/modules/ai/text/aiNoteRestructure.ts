import { App, Notice, MarkdownView } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { AIEditorUtils } from '../ai_utils/aiEditorUtils';
import { requestToAI } from '../ai_utils/aiUtils';
import { getContentWithoutFrontmatter } from '../../../modules/maintenance/utils/contentUtils';
import { FrontmatterManager } from '../../../modules/maintenance/utils/frontmatterManager';

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
            const systemPrompt = `당신은 텍스트 구조화 및 최적화 전문가입니다.
파레토 법칙(80:20 법칙)에 따라 핵심 정보를 중심으로 지식을 효율적으로 재구성하고 불필요한 정보는 과감히 제거합니다.

텍스트 재구조화 원칙:
- 모든 정보는 반드시 불렛 포인트 형식으로 계층적 구조화
- 가장 중요한 20%의 정보에 집중하여 80%의 가치 전달
- 모든 내용은 주어진, 그리고 추론한 주제에 직접적으로 관련된 정보만 포함
- 계층 구조는 개념의 논리적 관계를 정확히 반영
- 불렛은 '-' 기호를 사용하고 들여쓰기는 정확히 4칸 띄어쓰기로 통일
- 상위 개념에서 하위 개념으로 체계적 구조화
- 중복되는 정보는 통합하거나 제거
- 모든 내용은 완결된 문장이 아닌 핵심 키워드와 간결한 구문으로 표현
- 구체적 설명을 포함하여 명확하게 표현

처리 방법:
1. 주제(title)의 핵심 개념과 본질 파악
2. 관련 가능한 하위 개념과 요소 도출
3. 가장 중요한 요소부터 정확히 계층적으로 구조화
4. 파레토 법칙에 따라 핵심 20%에 해당하는 내용만 선별
5. 선별된 내용을 불렛 포인트 형식으로 정확히 계층화
6. 모든 내용을 주제와의 관련성에 따라 재배치
7. 기존 노트 내용이 있는 경우 이를 참고하여 보완

출력 형식:
- 모든 줄은 '- ' 또는 '    - '로 시작해야 함
- 계층 구조는 들여쓰기 4칸으로 표현
- 최대 3단계 깊이까지만 계층화
- 복잡한 개념은 여러 불렛으로 분리하여 명확히 표현`;

            // title 기반으로 관련 tags 생성을 위한 프롬프트 추가
            const tagsPrompt = `
또한, 다음 요구사항에 따라 현재 노트의 title("${title}")과 정확히 관련된 태그와 별칭(aliases)도 함께 생성해주세요:
1. 태그: 현재 노트 주제와 직접 관련된 가장 핵심 3-5개의 태그 제안 (각 태그는 #없이 단일 단어로)
2. 별칭: 현재 노트 제목의 다른 표현 또는 유사어 1-3개 (각 별칭은 작은따옴표 없이)

태그와 별칭은 문서 마지막에 다음 JSON 형식으로 추가:
\`\`\`json
{
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "aliases": ["별칭1", "별칭2", "별칭3"]
}
\`\`\``;

            const userPrompt = `${systemPrompt}

현재 노트 제목: "${title}"

${contentWithoutFrontmatter ? `현재 노트 내용:
${contentWithoutFrontmatter}` : '현재 노트에는 내용이 없습니다.'}

${tagsPrompt}

위 정보를 바탕으로, 파레토 법칙에 따라 주제("${title}")의 핵심 내용에 집중하여 불렛 포인트와 들여쓰기(4칸)로 완벽하게 구조화된 내용을 생성해주세요.`;

            new Notice('노트 내용 재구조화 중...');
            const response = await requestToAI(this.plugin, {
                userPrompt
            });

            // JSON 부분 추출
            let content = response;
            let jsonData = null;
            
            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch) {
                try {
                    jsonData = JSON.parse(jsonMatch[1]);
                    // JSON 부분 제거
                    content = response.replace(/```json\n[\s\S]*?\n```/, '').trim();
                } catch (error) {
                    console.error('JSON 파싱 오류:', error);
                }
            }

            // 프론트매터 업데이트
            let updatedFrontmatter = { ...frontmatter };
            
            if (jsonData) {
                // 기존 태그와 새 태그 병합 (기본 태그 유지, 중복 제거)
                const existingTags: string[] = frontmatter.tags || [];
                const defaultTags: string[] = FrontmatterManager.DEFAULT_TAGS;
                const nonDefaultExistingTags: string[] = existingTags.filter(
                    (tag: string) => !defaultTags.includes(tag)
                );
                
                // 새 태그 추가 (중복 제거)
                const allTags: string[] = [...defaultTags];
                const newTags: string[] = jsonData.tags || [];
                
                newTags.forEach((tag: string) => {
                    if (!allTags.includes(tag) && !nonDefaultExistingTags.includes(tag)) {
                        allTags.push(tag);
                    }
                });
                
                // 기존 비기본 태그 추가
                nonDefaultExistingTags.forEach((tag: string) => {
                    if (!allTags.includes(tag)) {
                        allTags.push(tag);
                    }
                });
                
                updatedFrontmatter.tags = allTags;
                
                // aliases 업데이트 (title은 항상 유지)
                const existingAliases = frontmatter.aliases || [];
                const currentTitle = frontmatter.title;
                let newAliases = [...existingAliases];
                
                // title이 aliases에 없으면 추가
                if (currentTitle && !newAliases.includes(currentTitle)) {
                    newAliases.push(currentTitle);
                }
                
                // 새 별칭 추가 (중복 제거)
                if (jsonData.aliases) {
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
