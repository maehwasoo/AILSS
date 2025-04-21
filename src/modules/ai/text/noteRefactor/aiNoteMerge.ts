import { App, TFile, Notice } from 'obsidian';
import AILSSPlugin from '../../../../../main';
import { requestToAI } from '../../ai_utils/aiUtils';
import { FrontmatterManager } from '../../../../core/utils/frontmatterManager';
import { 
    getContentWithoutFrontmatter, 
    prepareLinksForAI,
    restoreLinksFromAI,
    extractLinks,
    LinkType,
    moveAttachmentLinksToBottom,
    LinkInfo
} from '../../../../core/utils/contentUtils';
import { FORMATTING_RULES, NoteResult, CoreDependencies } from './types';

export class AINoteMerge {
    private app: App;
    private plugin: AILSSPlugin;
    private frontmatterManager: FrontmatterManager;
    
    constructor({ app, plugin }: CoreDependencies) {
        this.app = app;
        this.plugin = plugin;
        this.frontmatterManager = new FrontmatterManager();
    }

    /**
     * 여러 노트들의 내용을 하나의 노트로 통합합니다.
     * @param targetFile 통합의 대상이 되는 메인 노트
     * @param sourcesFiles 내용을 제공할 소스 노트들
     * @param applyChanges 변경사항을 즉시 적용할지 여부 (기본값: false)
     * @returns 변경될 노트 내용과 메타데이터
     */
    async mergeNotes(
        targetFile: TFile, 
        sourcesFiles: TFile[], 
        applyChanges: boolean = false
    ): Promise<NoteResult> {
        try {
            // 타겟 노트 읽기
            const targetContent = await this.app.vault.read(targetFile);
            const targetFrontmatter = this.frontmatterManager.parseFrontmatter(targetContent);
            
            if (!targetFrontmatter) {
                throw new Error('타겟 노트의 프론트매터를 찾을 수 없습니다.');
            }

            // 소스 노트들 읽기
            const sourceContents: string[] = [];
            const sourceTitles: string[] = [];
            
            for (const sourceFile of sourcesFiles) {
                const content = await this.app.vault.read(sourceFile);
                const sourceFrontmatter = this.frontmatterManager.parseFrontmatter(content);
                
                if (sourceFrontmatter && sourceFrontmatter.title) {
                    sourceTitles.push(sourceFrontmatter.title);
                } else {
                    sourceTitles.push(sourceFile.basename);
                }
                
                const contentWithoutFrontmatter = getContentWithoutFrontmatter(content);
                sourceContents.push(contentWithoutFrontmatter);
            }

            // AI 처리를 위한 프롬프트 생성
            const result = await this.mergingAIProcess(
                targetFrontmatter.title,
                getContentWithoutFrontmatter(targetContent),
                sourceTitles,
                sourceContents
            );

            // 프론트매터 준비
            // 1. 태그 통합
            let allTags = targetFrontmatter.tags ? [...targetFrontmatter.tags] : [];
            
            // 소스 노트들의 태그 통합
            for (let i = 0; i < sourcesFiles.length; i++) {
                const sourceContent = await this.app.vault.read(sourcesFiles[i]);
                const sourceFrontmatter = this.frontmatterManager.parseFrontmatter(sourceContent);
                
                if (sourceFrontmatter && sourceFrontmatter.tags) {
                    // 중복 제거하며 태그 추가
                    sourceFrontmatter.tags.forEach((tag: string) => {
                        if (!allTags.includes(tag)) {
                            allTags.push(tag);
                        }
                    });
                }
            }

            // 2. aliases 통합
            let allAliases = targetFrontmatter.aliases ? [...targetFrontmatter.aliases] : [];
            
            // 소스 노트들의 aliases 통합 (타이틀 포함)
            for (let i = 0; i < sourcesFiles.length; i++) {
                const sourceContent = await this.app.vault.read(sourcesFiles[i]);
                const sourceFrontmatter = this.frontmatterManager.parseFrontmatter(sourceContent);
                
                if (sourceFrontmatter) {
                    // 제목을 aliases에 추가
                    if (sourceFrontmatter.title && !allAliases.includes(sourceFrontmatter.title)) {
                        allAliases.push(sourceFrontmatter.title);
                    }
                    
                    // 기존 aliases 추가
                    if (sourceFrontmatter.aliases) {
                        sourceFrontmatter.aliases.forEach((alias: string) => {
                            if (!allAliases.includes(alias)) {
                                allAliases.push(alias);
                            }
                        });
                    }
                }
            }

            // 3. 업데이트된 프론트매터와 내용 결합
            const updatedFrontmatter = {
                ...targetFrontmatter,
                tags: allTags,
                aliases: allAliases,
                updated: new Date().toISOString().split('.')[0]
            };
            
            const finalContent = this.frontmatterManager.generateFrontmatter(updatedFrontmatter) + '\n\n' + result.trim();

            // 결과 반환
            const resultObj = {
                file: targetFile,
                title: targetFrontmatter.title || targetFile.basename,
                originalContent: targetContent,
                newContent: finalContent,
                frontmatter: updatedFrontmatter
            };
            
            // 변경사항 즉시 적용 옵션이 활성화된 경우에만 적용
            if (applyChanges) {
                await this.app.vault.modify(targetFile, finalContent);
                new Notice('노트 통합이 완료되었습니다.');
            }
            
            return resultObj;
        } catch (error: any) {
            console.error('노트 통합 중 오류 발생:', error);
            throw new Error(`노트 통합 중 오류 발생: ${error.message}`);
        }
    }

    /**
     * 노트 통합을 위한 AI 처리를 수행합니다.
     */
    private async mergingAIProcess(
        targetTitle: string,
        targetContent: string,
        sourceTitles: string[],
        sourceContents: string[]
    ): Promise<string> {
        // 대상 노트와 소스 노트들의 모든 첨부 파일 링크 추출
        const targetAttachmentLinks = extractLinks(targetContent, LinkType.AttachmentLink);
        const allSourceAttachmentLinks: LinkInfo[] = [];
        
        // 링크를 AI 처리를 위해 변환
        const { modifiedContent: processedTargetContent, linkPlaceholders: targetLinkPlaceholders } = 
            prepareLinksForAI(targetContent);
            
        // 소스 내용 결합 및 링크 처리
        let sourcesDescription = '';
        let allLinkPlaceholders = [...targetLinkPlaceholders];
        
        for (let i = 0; i < sourceTitles.length; i++) {
            // 소스 노트의 첨부 파일 링크 추출
            const sourceAttachmentLinks = extractLinks(sourceContents[i], LinkType.AttachmentLink);
            allSourceAttachmentLinks.push(...sourceAttachmentLinks);
            
            // 링크를 AI 처리에 적합하게 변환
            const { modifiedContent: processedSourceContent, linkPlaceholders: sourceLinkPlaceholders } = 
                prepareLinksForAI(sourceContents[i]);
                
            sourcesDescription += `\n\n문서 ${i + 1} (${sourceTitles[i]}):\n${processedSourceContent}`;
            allLinkPlaceholders = [...allLinkPlaceholders, ...sourceLinkPlaceholders];
        }

        const combinedPrompt = `당신은 문서 통합 및 재구성 전문가입니다.
여러 문서의 내용을 분석하여 하나의 통합된, 체계적인 문서로 재구성합니다.

통합 원칙:
- 주제와 하위 주제를 명확히 구분하여 계층적으로 구조화
- 중복 내용을 제거하고 유사한 정보는 통합
- 모든 중요 정보가 포함되도록 철저히 검토
- 내용 간의 논리적 흐름과 연결성 강화
- 통합된 내용의 일관성과 응집성 유지
- 각 섹션과 하위 섹션 간의 균형 유지
- 모든 출처의 핵심 내용이 보존되었는지 확인
- 노트 링크 내의 별칭은 일반 텍스트로 취급하고 관련 문맥에 맞게 배치
- 첨부 파일 링크는 문맥상 관련 있는 위치에 배치하되, 위치가 애매하다면 문서 하단에 별도 섹션으로 배치

용어 분석 및 통합 원칙:
- 각 문서에서 동일한 용어가 어떤 맥락과 관점에서 사용되었는지 분석
- 동일 용어의 각기 다른 정의나 설명을 비교하고 차이점을 명시
- 용어의 공통적인 의미와 특수한 활용 패턴을 구분하여 정리
- 상충되는 용어 정의가 있을 경우, 각 관점을 보존하면서 통합된 이해를 제공
- 용어 사용의 일관성을 유지하되 다양한 해석 가능성을 문서화
- 주요 용어에 대해서는 각 문서의 독특한 관점이나 접근 방식을 요약 제시
- 학문 분야나 이론적 배경에 따른 용어 해석 차이를 명확히 구분
${FORMATTING_RULES}

다음은 통합의 기준이 되는 메인 문서입니다:
제목: ${targetTitle}
내용:
${processedTargetContent}

다음은 통합할 다른 문서들입니다:${sourcesDescription}

위 모든 문서의 내용을 분석하여 하나의 체계적이고 포괄적인 문서로 통합해주세요. 주요 개념은 적절한 헤더로 구분하고, 논리적 흐름을 가진 일관된 문서를 생성해주세요. 중복 내용은 제거하고, 모든 문서의 중요한 정보가 손실되지 않도록 해주세요.

노트 내의 링크 별칭들이 텍스트 사이에 있을 수 있습니다. 이 별칭 텍스트를 일반 텍스트처럼 취급하여 적절한 문맥 속에 배치해주세요. 별칭은 해당 개념을 설명하는 단어일 가능성이 높으므로 원래 문맥을 고려하여 통합해주세요.

문서들 사이에 공통으로 등장하는 주요 용어나 개념을 찾아 분석해주세요:
1. 각 문서에서 동일 용어가 어떻게 다르게 정의되거나 사용되었는지 비교하세요.
2. 용어의 공통 의미와 각 문서별 특수한 의미를 구분하여 설명하세요.
3. 용어에 대한 다양한 관점과 해석을 종합하여 보다 풍부한 이해를 제공하세요.
4. 필요한 경우 "다양한 관점" 또는 "용어 분석" 섹션을 만들어 중요 용어의 여러 해석을 비교하세요.

통합된 문서는 모든 원본 문서의 중요 정보를 포함하되, 특히 동일 주제나 용어에 대한 다양한 관점과 해석을 명확히 드러내도록 해주세요.`;

        const response = await requestToAI(this.plugin, {
            combinedPrompt
        });

        // AI 응답에서 링크 플레이스홀더를 원래 링크로 복원
        let restoredContent = restoreLinksFromAI(response, allLinkPlaceholders);
        
        // 소스 노트들의 첨부 파일 링크를 통합 노트 하단으로 이동
        if (allSourceAttachmentLinks.length > 0) {
            restoredContent = moveAttachmentLinksToBottom(restoredContent, allSourceAttachmentLinks);
        }

        return restoredContent;
    }
}