import { App, Editor, MarkdownView, Notice, TFile } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { requestToAI } from '../ai_utils/aiUtils';
import { FrontmatterManager } from '../../maintenance/utils/frontmatterManager';

interface AITagAliasResponse {
    tagsToKeep: string[];
    tagsToAdd: string[];
    tagsToRemove: string[];
    aliasesToKeep: string[];
    aliasesToAdd: string[];
    aliasesToRemove: string[];
    explanation: string;
}

export class AITagAliasRefactor {
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
        const file = activeView.file;
        
        if (!file) {
            new Notice('현재 파일을 찾을 수 없습니다.');
            return;
        }

        try {
            new Notice('태그와 별칭 분석 중...');
            
            // 현재 노트의 내용 가져오기
            const content = await this.app.vault.read(file);
            
            // 프론트매터 파싱
            const frontmatterManager = new FrontmatterManager();
            const frontmatter = frontmatterManager.parseFrontmatter(content);
            
            if (!frontmatter) {
                new Notice('프론트매터를 찾을 수 없습니다.');
                return;
            }
            
            // 볼트에 있는 모든 태그 수집
            const allTags = await this.getAllTagsInVault();
            
            // 볼트에 있는 모든 별칭 수집
            const allAliases = await this.getAllAliasesInVault();
            
            // 현재 노트의 내용만 추출 (프론트매터 제외)
            const noteContent = this.extractContentWithoutFrontmatter(content);
            
            // AI에 프롬프트 전송
            const response = await this.analyzeTagsAndAliases(
                noteContent,
                frontmatter.tags || [],
                frontmatter.aliases || [],
                allTags,
                allAliases
            );
            
            // 프론트매터에 변경사항 적용
            await this.applyFrontmatterChanges(file, content, frontmatterManager, response);
            
        } catch (error) {
            console.error('태그 및 별칭 분석 중 오류 발생:', error);
            new Notice('태그 및 별칭 분석 중 오류가 발생했습니다.');
        }
    }
    
    /**
     * 볼트에 있는 모든 태그를 수집하는 메서드
     */
    private async getAllTagsInVault(): Promise<string[]> {
        const allTags = new Set<string>();
        
        // 모든 마크다운 파일을 순회하며 태그 수집
        const markdownFiles = this.app.vault.getMarkdownFiles();
        
        for (const file of markdownFiles) {
            try {
                const content = await this.app.vault.read(file);
                
                // 텍스트 내의 #태그 패턴 추출 (정규식 사용)
                const tagRegex = /#([a-zA-Z가-힣0-9_\-/]+)/g;
                let match;
                while ((match = tagRegex.exec(content)) !== null) {
                    if (match[1]) {
                        allTags.add(match[1]);
                    }
                }
                
                // 프론트매터에서도 태그 확인
                const frontmatterManager = new FrontmatterManager();
                const frontmatter = frontmatterManager.parseFrontmatter(content);
                
                if (frontmatter && frontmatter.tags && Array.isArray(frontmatter.tags)) {
                    frontmatter.tags.forEach(tag => allTags.add(tag));
                }
            } catch (error) {
                console.error(`파일 ${file.path}에서 태그 추출 중 오류:`, error);
            }
        }
        
        return Array.from(allTags);
    }
    
    /**
     * 볼트에 있는 모든 별칭을 수집하는 메서드
     */
    private async getAllAliasesInVault(): Promise<string[]> {
        const allAliases = new Set<string>();
        
        // 모든 마크다운 파일을 순회하며 별칭 수집
        const markdownFiles = this.app.vault.getMarkdownFiles();
        
        for (const file of markdownFiles) {
            try {
                const content = await this.app.vault.read(file);
                
                // 프론트매터에서 별칭 확인
                const frontmatterManager = new FrontmatterManager();
                const frontmatter = frontmatterManager.parseFrontmatter(content);
                
                if (frontmatter && frontmatter.aliases && Array.isArray(frontmatter.aliases)) {
                    frontmatter.aliases.forEach(alias => allAliases.add(alias));
                }
            } catch (error) {
                console.error(`파일 ${file.path}에서 별칭 추출 중 오류:`, error);
            }
        }
        
        return Array.from(allAliases);
    }
    
    /**
     * 프론트매터를 제외한 내용 추출
     */
    private extractContentWithoutFrontmatter(content: string): string {
        const frontMatterRegex = /^---\n([\s\S]*?)\n---/;
        return content.replace(frontMatterRegex, '').trim();
    }
    
    /**
     * AI를 사용하여 태그와 별칭을 분석
     */
    private async analyzeTagsAndAliases(
        content: string,
        currentTags: string[],
        currentAliases: string[],
        allTags: string[],
        allAliases: string[]
    ): Promise<AITagAliasResponse> {
        const systemPrompt = `You are a document metadata expert.
Analyze the given note content and suggest appropriate tags and aliases.

Please follow these guidelines:
1. Thoroughly analyze the note content to identify key topics and concepts.
2. Evaluate whether the current tags and aliases are appropriate.
3. Refer to the existing tags and aliases in the vault for consistency.
4. Suggest new tags or aliases if needed.
5. Suggest removing inappropriate tags or aliases with reasons.

Please provide your results in the following JSON format:
{
  "tagsToKeep": ["tag1", "tag2"],
  "tagsToAdd": ["newTag1", "newTag2"],
  "tagsToRemove": ["oldTag1", "oldTag2"],
  "aliasesToKeep": ["alias1", "alias2"],
  "aliasesToAdd": ["newAlias1", "newAlias2"],
  "aliasesToRemove": ["oldAlias1", "oldAlias2"],
  "explanation": "Brief explanation of changes"
}

Each array can be empty, but all keys must be included.
Also include default tags like "Inbox" in the appropriate category (keep/add/remove).

Important: Always respond in English. Tag and alias names should be in English where possible, or use clear transliterations for non-English concepts.`;

        const userPrompt = `${systemPrompt}

Note content:
${content}

Current tags:
${currentTags.join(', ')}

Current aliases:
${currentAliases.join(', ')}

Existing tags in the vault:
${allTags.join(', ')}

Existing aliases in the vault:
${allAliases.join(', ')}`;

        try {
            const response = await requestToAI(this.plugin, {
                userPrompt
            });
            
            // AI 응답을 JSON으로 파싱
            let parsedResponse: AITagAliasResponse;
            try {
                // 응답이 JSON 형식인지 확인
                if (response.trim().startsWith('{') && response.trim().endsWith('}')) {
                    parsedResponse = JSON.parse(response);
                } else {
                    // JSON 블록 추출 시도
                    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                                     response.match(/```\n([\s\S]*?)\n```/) ||
                                     response.match(/\{[\s\S]*?\}/);
                    
                    if (jsonMatch) {
                        parsedResponse = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                    } else {
                        throw new Error('Unable to find JSON format in response.');
                    }
                }
                
                // 필수 필드 확인
                const requiredFields = ['tagsToKeep', 'tagsToAdd', 'tagsToRemove', 
                                       'aliasesToKeep', 'aliasesToAdd', 'aliasesToRemove', 
                                       'explanation'];
                
                const missingFields = requiredFields.filter(field => !(field in parsedResponse));
                
                if (missingFields.length > 0) {
                    throw new Error(`Required fields missing in response: ${missingFields.join(', ')}`);
                }
                
                return parsedResponse;
            } catch (error) {
                console.error('Error parsing AI response:', error);
                console.log('Original response:', response);
                
                // 기본 응답 반환 (현재 값 유지)
                return {
                    tagsToKeep: currentTags,
                    tagsToAdd: [],
                    tagsToRemove: [],
                    aliasesToKeep: currentAliases,
                    aliasesToAdd: [],
                    aliasesToRemove: [],
                    explanation: 'Error parsing response. Keeping current values.'
                };
            }
        } catch (error) {
            console.error('Error during AI request:', error);
            throw error;
        }
    }
    
    /**
     * 프론트매터 변경사항 적용
     */
    private async applyFrontmatterChanges(
        file: TFile, 
        content: string, 
        frontmatterManager: FrontmatterManager, 
        changes: AITagAliasResponse
    ) {
        try {
            // 현재 프론트매터 가져오기
            const currentFrontmatter = frontmatterManager.parseFrontmatter(content);
            
            if (!currentFrontmatter) {
                new Notice('프론트매터를 찾을 수 없습니다.');
                return;
            }
            
            // 태그 업데이트
            const updatedTags = [
                ...changes.tagsToKeep,
                ...changes.tagsToAdd
            ].filter(tag => !changes.tagsToRemove.includes(tag));
            
            // 별칭 업데이트
            const updatedAliases = [
                ...changes.aliasesToKeep,
                ...changes.aliasesToAdd
            ].filter(alias => !changes.aliasesToRemove.includes(alias));
            
            // 고유한 값만 유지
            const uniqueTags = [...new Set(updatedTags)];
            const uniqueAliases = [...new Set(updatedAliases)];
            
            // 프론트매터 업데이트
            const updates = {
                tags: uniqueTags,
                aliases: uniqueAliases,
                // updated 필드 현재 시간으로 업데이트
                updated: new Date().toISOString().split('.')[0]
            };
            
            // 프론트매터 업데이트
            const updatedContent = frontmatterManager.updateFrontmatter(content, updates);
            
            // 파일에 변경사항 저장
            await this.app.vault.modify(file, updatedContent);
            
            // 성공 메시지 표시
            const tagsAdded = changes.tagsToAdd.length;
            const tagsRemoved = changes.tagsToRemove.length;
            const aliasesAdded = changes.aliasesToAdd.length;
            const aliasesRemoved = changes.aliasesToRemove.length;
            
            const changeCount = tagsAdded + tagsRemoved + aliasesAdded + aliasesRemoved;
            
            if (changeCount > 0) {
                let message = '메타데이터 업데이트 완료: ';
                const changes = [];
                
                if (tagsAdded > 0) changes.push(`태그 ${tagsAdded}개 추가`);
                if (tagsRemoved > 0) changes.push(`태그 ${tagsRemoved}개 제거`);
                if (aliasesAdded > 0) changes.push(`별칭 ${aliasesAdded}개 추가`);
                if (aliasesRemoved > 0) changes.push(`별칭 ${aliasesRemoved}개 제거`);
                
                message += changes.join(', ');
                new Notice(message);
            } else {
                new Notice('메타데이터가 이미 최적화되어 있습니다.');
            }
            
            // 상세 변경 내용 콘솔에 출력
            console.log('메타데이터 변경 내용:', changes.explanation);
            console.log('추가된 태그:', changes.tagsToAdd);
            console.log('제거된 태그:', changes.tagsToRemove);
            console.log('추가된 별칭:', changes.aliasesToAdd);
            console.log('제거된 별칭:', changes.aliasesToRemove);
            
        } catch (error) {
            console.error('프론트매터 업데이트 중 오류:', error);
            new Notice('프론트매터 업데이트 중 오류가 발생했습니다.');
        }
    }
}