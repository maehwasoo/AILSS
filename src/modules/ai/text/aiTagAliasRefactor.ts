import { App, Editor, MarkdownView, Notice, TFile, getAllTags } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { requestToAI } from '../ai_utils/aiUtils';
import { FrontmatterManager } from '../../maintenance/utils/frontmatterManager';

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
            
            // 결과 표시
            this.displayResults(editor, response);
            
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
    ): Promise<string> {
        const systemPrompt = `당신은 문서 메타데이터 전문가입니다.
주어진 노트 내용을 분석하여 적절한 태그와 별칭(aliases)을 제안합니다.

다음 지침을 따라주세요:
1. 노트 내용을 철저히 분석하여 핵심 주제와 개념을 파악합니다.
2. 현재 설정된 태그와 별칭이 적절한지 평가합니다.
3. 볼트에 있는 기존 태그와 별칭 목록을 참고하여 일관성 있는 제안을 합니다.
4. 새로운 태그나 별칭이 필요하다면 추가 제안합니다.
5. 제거해야 할 부적절한 태그나 별칭이 있다면 그 이유와 함께 제안합니다.

결과는 다음 형식으로 제공해 주세요:
1. 현재 설정의 적절성 평가
2. 태그 제안 (유지, 추가, 제거)
3. 별칭 제안 (유지, 추가, 제거)
4. 종합적인 권장사항

각 제안은 근거와 함께 제시해주시고, 볼트의 기존 태그와 별칭과의 일관성을 고려해주세요.`;

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
            
            return response;
        } catch (error) {
            console.error('AI 요청 중 오류 발생:', error);
            throw error;
        }
    }
    
    /**
     * 결과를 편집기에 표시
     */
    private displayResults(editor: Editor, response: string) {
        const currentPos = editor.getCursor();
        const endOfContent = {
            line: editor.lineCount(),
            ch: editor.getLine(editor.lineCount() - 1).length
        };
        
        editor.replaceRange(`\n\n## 태그 및 별칭 분석 결과\n${response}\n`, endOfContent);
        new Notice('태그 및 별칭 분석이 완료되었습니다.');
    }
}