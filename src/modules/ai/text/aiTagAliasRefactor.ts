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
        const systemPrompt = `당신은 문서 메타데이터 전문가입니다.
주어진 노트 내용을 분석하여 적절한 태그와 별칭(aliases)을 제안합니다.

다음 지침을 따라주세요:
1. 노트 내용을 철저히 분석하여 핵심 주제와 개념을 파악합니다.
2. 현재 설정된 태그와 별칭이 적절한지 평가합니다.
3. 볼트에 있는 기존 태그와 별칭 목록을 참고하여 일관성 있는 제안을 합니다.
4. 새로운 태그나 별칭이 필요하다면 추가 제안합니다.
5. 제거해야 할 부적절한 태그나 별칭이 있다면 그 이유와 함께 제안합니다.

결과는 다음 JSON 형식으로 제공해 주세요:
{
  "tagsToKeep": ["유지할 태그1", "유지할 태그2"],
  "tagsToAdd": ["추가할 태그1", "추가할 태그2"],
  "tagsToRemove": ["제거할 태그1", "제거할 태그2"],
  "aliasesToKeep": ["유지할 별칭1", "유지할 별칭2"],
  "aliasesToAdd": ["추가할 별칭1", "추가할 별칭2"],
  "aliasesToRemove": ["제거할 별칭1", "제거할 별칭2"],
  "explanation": "변경 사항에 대한 간단한 설명"
}

각 배열은 비어있을 수 있지만, 모든 키는 반드시 포함되어야 합니다.
특히 "Inbox"와 같은 기본 태그도 적절한 카테고리(keep/add/remove)에 포함시키세요.`;

        const userPrompt = `${systemPrompt}

노트 내용:
${content}

현재 태그:
${currentTags.join(', ')}

현재 별칭:
${currentAliases.join(', ')}

볼트의 기존 태그 목록:
${allTags.join(', ')}

볼트의 기존 별칭 목록:
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
                        throw new Error('응답에서 JSON 형식을 찾을 수 없습니다.');
                    }
                }
                
                // 필수 필드 확인
                const requiredFields = ['tagsToKeep', 'tagsToAdd', 'tagsToRemove', 
                                       'aliasesToKeep', 'aliasesToAdd', 'aliasesToRemove', 
                                       'explanation'];
                
                const missingFields = requiredFields.filter(field => !(field in parsedResponse));
                
                if (missingFields.length > 0) {
                    throw new Error(`응답에 필수 필드가 누락되었습니다: ${missingFields.join(', ')}`);
                }
                
                return parsedResponse;
            } catch (error) {
                console.error('AI 응답 파싱 중 오류:', error);
                console.log('원본 응답:', response);
                
                // 기본 응답 반환 (현재 값 유지)
                return {
                    tagsToKeep: currentTags,
                    tagsToAdd: [],
                    tagsToRemove: [],
                    aliasesToKeep: currentAliases,
                    aliasesToAdd: [],
                    aliasesToRemove: [],
                    explanation: '응답 파싱 중 오류가 발생했습니다. 현재 값을 유지합니다.'
                };
            }
        } catch (error) {
            console.error('AI 요청 중 오류 발생:', error);
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