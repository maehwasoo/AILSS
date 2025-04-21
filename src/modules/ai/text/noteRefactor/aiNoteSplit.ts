import { App, TFile, Notice } from 'obsidian';
import AILSSPlugin from '../../../../../main';
import { requestToAI } from '../../ai_utils/aiUtils';
import { FrontmatterManager } from '../../../../core/utils/frontmatterManager';
import { PathSettings } from '../../../../core/settings/pathSettings';
import { 
    getContentWithoutFrontmatter, 
    prepareLinksForAI,
    restoreLinksFromAI,
    LinkInfo
} from '../../../../core/utils/contentUtils';
import { FORMATTING_RULES, SplitResult, CoreDependencies } from './types';

export class AINoteSplit {
    private app: App;
    private plugin: AILSSPlugin;
    private frontmatterManager: FrontmatterManager;
    
    constructor({ app, plugin }: CoreDependencies) {
        this.app = app;
        this.plugin = plugin;
        this.frontmatterManager = new FrontmatterManager();
    }

    /**
     * 노트의 내용을 분석하여 여러 개의 노트로 분할합니다.
     * @param sourceFile 분할할 소스 노트
     * @param applyChanges 변경사항을 즉시 적용할지 여부 (기본값: false)
     * @returns 변경될 노트 내용과 생성될 새 노트들의 정보
     */
    async splitNote(
        sourceFile: TFile, 
        applyChanges: boolean = false
    ): Promise<SplitResult> {
        try {
            // 노트 개수 제한 확인
            if (!(await PathSettings.checkNoteLimit(this.app, this.plugin))) {
                throw new Error(`노트 개수가 최대 제한(${PathSettings.MAX_NOTES}개)에 도달했습니다.`);
            }
            
            // 소스 노트 읽기
            const sourceContent = await this.app.vault.read(sourceFile);
            const sourceFrontmatter = this.frontmatterManager.parseFrontmatter(sourceContent);
            
            if (!sourceFrontmatter) {
                throw new Error('소스 노트의 프론트매터를 찾을 수 없습니다.');
            }

            const sourceTitle = sourceFrontmatter.title || sourceFile.basename;
            const contentWithoutFrontmatter = getContentWithoutFrontmatter(sourceContent);

            // AI 처리를 위한 프롬프트 생성
            const result = await this.splittingAIProcess(sourceTitle, contentWithoutFrontmatter);

            // 결과 파싱
            if (!result.mainContent || !result.splitContents || result.splitContents.length === 0) {
                throw new Error('AI 처리 결과가 유효하지 않습니다.');
            }

            // 소스 노트의 새 내용 생성
            const updatedSourceFrontmatter = {
                ...sourceFrontmatter,
                updated: new Date().toISOString().split('.')[0]
            };
            
            const updatedSourceContent = this.frontmatterManager.generateFrontmatter(updatedSourceFrontmatter) +
                '\n\n' + result.mainContent.trim();
            
            // 분할된 새 노트들 정보 준비
            const newNotes = result.splitContents
                .filter(item => item.title && item.content)
                .map(splitItem => ({
                    title: splitItem.title,
                    content: splitItem.content.trim(),
                    frontmatter: {
                        title: splitItem.title,
                        tags: sourceFrontmatter.tags || [],
                        aliases: [splitItem.title],
                        created: new Date().toISOString().split('.')[0],
                        updated: new Date().toISOString().split('.')[0]
                    }
                }));
            
            // 결과 객체 생성
            const resultObj = {
                originalFile: {
                    file: sourceFile,
                    title: sourceTitle,
                    originalContent: sourceContent,
                    newContent: updatedSourceContent,
                    frontmatter: updatedSourceFrontmatter
                },
                newNotes
            };
            
            // 변경사항 즉시 적용 옵션이 활성화된 경우에만 적용
            if (applyChanges) {
                // 소스 노트 업데이트
                await this.app.vault.modify(sourceFile, updatedSourceContent);
                
                // 분할된 노트들 생성
                const createdNotes: TFile[] = [];
                
                for (const noteInfo of newNotes) {
                    // 새 노트 생성
                    const { file } = await PathSettings.createNote({
                        app: this.app,
                        frontmatterConfig: noteInfo.frontmatter,
                        content: noteInfo.content,
                        isInherited: false
                    });
                    
                    createdNotes.push(file);
                }
                
                new Notice(`노트 분할이 완료되었습니다. ${createdNotes.length}개의 새 노트가 생성되었습니다.`);
            }
            
            return resultObj;
        } catch (error: any) {
            console.error('노트 분할 중 오류 발생:', error);
            throw new Error(`노트 분할 중 오류 발생: ${error.message}`);
        }
    }

    /**
     * 노트 분할을 위한 AI 처리를 수행합니다.
     */
    private async splittingAIProcess(
        sourceTitle: string,
        sourceContent: string
    ): Promise<{
        mainContent: string;
        splitContents: Array<{
            title: string;
            content: string;
        }>;
    }> {
        // 링크를 플레이스홀더로 대체
        const { modifiedContent: processedContent, linkPlaceholders } = 
            prepareLinksForAI(sourceContent);

        const combinedPrompt = `당신은 문서 분석 및 분할 전문가입니다.
문서의 내용을 분석하여 주제별로 분할하고, 원본 문서는 주제에 맞게 정리합니다.

분할 원칙:
- 원본 문서의 제목과 직접 관련된 내용만 원본에 유지
- 다른 주제는 별도 문서로 분할하여 추출
- 분할된 각 문서는 명확한 주제와 체계적인 구조를 가짐
- 주제 간 경계가 명확하고 내용 중복 최소화
- 분할 과정에서 중요 정보 손실 방지
- 원본 문서와 분할 문서 간의 논리적 연결성 유지
- 각 문서의 독립성과 완결성 보장
- 모든 내부 링크(Obsidian 링크) 형식은 반드시 보존 (예: [[노트명|별칭]], ![[첨부파일|별칭]])
${FORMATTING_RULES}

다음은 분할할 문서입니다:
제목: ${sourceTitle}
내용:
${processedContent}

다음 작업을 수행해주세요:
1. 위 문서를 분석하여 주제별로 분할하세요.
2. 원본 문서의 제목("${sourceTitle}")과 직접 관련된 내용만 추출하여 보존하세요.
3. 다른 주제의 내용은 별도 문서로 분할하세요. 각 분할 문서는 명확한 제목과 체계적인 구조를 가져야 합니다.
4. 결과는 반드시 다음 JSON 형식으로 반환하세요:
\`\`\`json
{
  "mainContent": "원본 문서에 남길 내용 (제목 '${sourceTitle}'과 직접 관련된 내용)",
  "splitContents": [
    {
      "title": "첫 번째 분할 문서 제목",
      "content": "첫 번째 분할 문서 내용"
    },
    {
      "title": "두 번째 분할 문서 제목",
      "content": "두 번째 분할 문서 내용"
    }
    // 필요한 만큼 추가
  ]
}
\`\`\`

분할 결과를 위 JSON 형식으로만 반환하고, 추가 설명이나 다른 형식은 포함하지 마세요.`;

        const response = await requestToAI(this.plugin, {
            combinedPrompt
        });

        try {
            // JSON 형식 추출
            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                             response.match(/```\n([\s\S]*?)\n```/);
            
            // jsonMatch가 있으면 그 안의 내용 사용, 없으면 전체 응답 사용
            const jsonContent = jsonMatch && jsonMatch[1] ? jsonMatch[1] : response;
            const parsedResult = JSON.parse(jsonContent);
            
            // 플레이스홀더를 원래 링크로 복원
            const restoredMainContent = restoreLinksFromAI(
                parsedResult.mainContent || '', 
                linkPlaceholders
            );
            
            // 분할된 내용들의 링크도 복원
            const restoredSplitContents = (parsedResult.splitContents || []).map(
                (splitContent: {title: string; content: string}) => ({
                    title: splitContent.title,
                    content: restoreLinksFromAI(splitContent.content, linkPlaceholders)
                })
            );
            
            return {
                mainContent: restoredMainContent,
                splitContents: restoredSplitContents
            };
        } catch (error) {
            console.error('AI 응답 파싱 오류:', error);
            throw new Error('AI 응답을 처리할 수 없습니다. 응답 형식이 올바르지 않습니다.');
        }
    }
}