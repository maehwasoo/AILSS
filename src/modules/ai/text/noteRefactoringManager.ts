import { App, TFile, Notice } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { requestToAI } from '../ai_utils/aiUtils';
import { FrontmatterManager } from '../../maintenance/utils/frontmatterManager';
import { PathSettings } from '../../maintenance/settings/pathSettings';
import { getContentWithoutFrontmatter } from '../../maintenance/utils/contentUtils';

export class NoteRefactoringManager {
    private app: App;
    private plugin: AILSSPlugin;
    private frontmatterManager: FrontmatterManager;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.frontmatterManager = new FrontmatterManager();
    }

    /**
     * 여러 노트들의 내용을 하나의 노트로 통합합니다.
     * @param targetFile 통합의 대상이 되는 메인 노트
     * @param sourcesFiles 내용을 제공할 소스 노트들
     */
    async mergeNotes(targetFile: TFile, sourcesFiles: TFile[]): Promise<void> {
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

            // 타겟 노트 업데이트
            await this.app.vault.modify(targetFile, finalContent);
            
            new Notice('노트 통합이 완료되었습니다.');
        } catch (error: any) {
            console.error('노트 통합 중 오류 발생:', error);
            throw new Error(`노트 통합 중 오류 발생: ${error.message}`);
        }
    }

    /**
     * 노트의 내용을 분석하여 여러 개의 노트로 분할합니다.
     * @param sourceFile 분할할 소스 노트
     */
    async splitNote(sourceFile: TFile): Promise<void> {
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

            // 1. 소스 노트 업데이트
            const updatedSourceFrontmatter = {
                ...sourceFrontmatter,
                updated: new Date().toISOString().split('.')[0]
            };
            
            const updatedSourceContent = this.frontmatterManager.generateFrontmatter(updatedSourceFrontmatter) +
                '\n\n' + result.mainContent.trim();
            
            await this.app.vault.modify(sourceFile, updatedSourceContent);

            // 2. 분할된 노트들 생성
            const createdNotes: TFile[] = [];
            
            for (const splitItem of result.splitContents) {
                if (!splitItem.title || !splitItem.content) continue;
                
                // 새 노트 생성
                const { file } = await PathSettings.createNote({
                    app: this.app,
                    frontmatterConfig: {
                        title: splitItem.title,
                        tags: sourceFrontmatter.tags || [],
                        aliases: [splitItem.title]
                    },
                    content: splitItem.content.trim(),
                    isInherited: false
                });
                
                createdNotes.push(file);
            }

            new Notice(`노트 분할이 완료되었습니다. ${createdNotes.length}개의 새 노트가 생성되었습니다.`);
            
            return;
        } catch (error: any) {
            console.error('노트 분할 중 오류 발생:', error);
            throw new Error(`노트 분할 중 오류 발생: ${error.message}`);
        }
    }

    /**
     * 여러 노트 간의 내용을 주제에 따라 재조정합니다.
     * @param mainFile 메인 노트
     * @param otherFiles 다른 노트들
     */
    async adjustNotes(mainFile: TFile, otherFiles: TFile[]): Promise<void> {
        try {
            // 모든 노트의 내용 및 메타데이터 수집
            const allNotes: {
                file: TFile;
                title: string;
                content: string;
                frontmatter: Record<string, any>;
            }[] = [];
            
            // 메인 노트 정보 추가
            const mainContent = await this.app.vault.read(mainFile);
            const mainFrontmatter = this.frontmatterManager.parseFrontmatter(mainContent);
            
            if (!mainFrontmatter) {
                throw new Error('메인 노트의 프론트매터를 찾을 수 없습니다.');
            }
            
            allNotes.push({
                file: mainFile,
                title: mainFrontmatter.title || mainFile.basename,
                content: getContentWithoutFrontmatter(mainContent),
                frontmatter: mainFrontmatter
            });
            
            // 다른 노트들 정보 추가
            for (const file of otherFiles) {
                const content = await this.app.vault.read(file);
                const frontmatter = this.frontmatterManager.parseFrontmatter(content);
                
                if (!frontmatter) {
                    throw new Error(`노트 '${file.basename}'의 프론트매터를 찾을 수 없습니다.`);
                }
                
                allNotes.push({
                    file,
                    title: frontmatter.title || file.basename,
                    content: getContentWithoutFrontmatter(content),
                    frontmatter
                });
            }
            
            // AI 처리를 위한 프롬프트 생성
            const result = await this.adjustingAIProcess(allNotes);
            
            // 각 노트 업데이트
            for (let i = 0; i < allNotes.length; i++) {
                const note = allNotes[i];
                const updatedContent = result.noteContents[i];
                
                if (!updatedContent) continue;
                
                // 프론트매터 업데이트
                const updatedFrontmatter = {
                    ...note.frontmatter,
                    updated: new Date().toISOString().split('.')[0]
                };
                
                // 최종 내용 생성
                const finalContent = this.frontmatterManager.generateFrontmatter(updatedFrontmatter) +
                    '\n\n' + updatedContent.trim();
                
                // 노트 업데이트
                await this.app.vault.modify(note.file, finalContent);
            }
            
            new Notice(`노트 조정이 완료되었습니다. ${allNotes.length}개의 노트가 업데이트되었습니다.`);
            
            return;
        } catch (error: any) {
            console.error('노트 조정 중 오류 발생:', error);
            throw new Error(`노트 조정 중 오류 발생: ${error.message}`);
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
        const systemPrompt = `당신은 문서 통합 및 재구성 전문가입니다.
여러 문서의 내용을 분석하여 하나의 통합된, 체계적인 문서로 재구성합니다.

통합 원칙:
- 주제와 하위 주제를 명확히 구분하여 계층적으로 구조화
- 중복 내용을 제거하고 유사한 정보는 통합
- 모든 중요 정보가 포함되도록 철저히 검토
- 내용 간의 논리적 흐름과 연결성 강화
- 통합된 내용의 일관성과 응집성 유지
- 각 섹션과 하위 섹션 간의 균형 유지
- 모든 출처의 핵심 내용이 보존되었는지 확인

포맷팅 규칙:
- 주요 섹션은 # 또는 ## 헤더로 명확히 구분
- 소제목과 중요 개념은 ### 또는 #### 수준의 헤더로 구분
- 중요 개념이나 키워드는 **볼드체**로 강조
- 정의나 특별한 용어는 *이탤릭체*로 표시
- 핵심 아이디어나 중요 포인트는 ==하이라이트==로 강조
- 목록이 필요한 경우 불릿 포인트(-) 또는 번호 목록(1., 2.)을 적절히 활용
- 복잡한 정보는 표 형식으로 구조화
- 인용이 필요한 경우 > 블록인용구 활용`;

        // 소스 내용 결합
        let sourcesDescription = '';
        for (let i = 0; i < sourceTitles.length; i++) {
            sourcesDescription += `\n\n문서 ${i + 1} (${sourceTitles[i]}):\n${sourceContents[i]}`;
        }

        const userPrompt = `${systemPrompt}

다음은 통합의 기준이 되는 메인 문서입니다:
제목: ${targetTitle}
내용:
${targetContent}

다음은 통합할 다른 문서들입니다:${sourcesDescription}

위 모든 문서의 내용을 분석하여 하나의 체계적이고 포괄적인 문서로 통합해주세요. 주요 개념은 적절한 헤더로 구분하고, 논리적 흐름을 가진 일관된 문서를 생성해주세요. 중복 내용은 제거하고, 모든 문서의 중요한 정보가 손실되지 않도록 해주세요.`;

        const response = await requestToAI(this.plugin, {
            userPrompt
        });

        return response;
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
        const systemPrompt = `당신은 문서 분석 및 분할 전문가입니다.
문서의 내용을 분석하여 주제별로 분할하고, 원본 문서는 주제에 맞게 정리합니다.

분할 원칙:
- 원본 문서의
- 원본 문서의 제목과 직접 관련된 내용만 원본에 유지
- 다른 주제는 별도 문서로 분할하여 추출
- 분할된 각 문서는 명확한 주제와 체계적인 구조를 가짐
- 주제 간 경계가 명확하고 내용 중복 최소화
- 분할 과정에서 중요 정보 손실 방지
- 원본 문서와 분할 문서 간의 논리적 연결성 유지
- 각 문서의 독립성과 완결성 보장

포맷팅 규칙:
- 주요 섹션은 # 또는 ## 헤더로 명확히 구분
- 소제목과 중요 개념은 ### 또는 #### 수준의 헤더로 구분
- 중요 개념이나 키워드는 **볼드체**로 강조
- 정의나 특별한 용어는 *이탤릭체*로 표시
- 핵심 아이디어나 중요 포인트는 ==하이라이트==로 강조
- 목록이 필요한 경우 불릿 포인트(-) 또는 번호 목록(1., 2.)을 적절히 활용
- 복잡한 정보는 표 형식으로 구조화
- 인용이 필요한 경우 > 블록인용구 활용`;

        const userPrompt = `${systemPrompt}

다음은 분할할 문서입니다:
제목: ${sourceTitle}
내용:
${sourceContent}

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
            userPrompt
        });

        try {
            // JSON 형식 추출
            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                             response.match(/```\n([\s\S]*?)\n```/) ||
                             [null, response];
            
            const jsonContent = jsonMatch ? jsonMatch[1] : response;
            const parsedResult = JSON.parse(jsonContent);
            
            return {
                mainContent: parsedResult.mainContent || '',
                splitContents: parsedResult.splitContents || []
            };
        } catch (error) {
            console.error('AI 응답 파싱 오류:', error);
            throw new Error('AI 응답을 처리할 수 없습니다. 응답 형식이 올바르지 않습니다.');
        }
    }

    /**
     * 노트 조정을 위한 AI 처리를 수행합니다.
     */
    private async adjustingAIProcess(
        notes: Array<{
            file: TFile;
            title: string;
            content: string;
            frontmatter: Record<string, any>;
        }>
    ): Promise<{
        noteContents: string[];
    }> {
        const systemPrompt = `당신은 문서 내용 최적화 및 재배치 전문가입니다.
여러 문서의 내용을 분석하여 각 문서의 주제에 맞게 내용을 재배치합니다.

조정 원칙:
- 각 문서의 제목과 관련된 내용만 해당 문서에 유지
- 다른 주제에 더 적합한 내용은 해당 주제의 문서로 이동
- 정보의 손실 없이 모든 내용이 가장 적합한 문서에 배치
- 중복 내용 제거 및 유사 내용 통합
- 각 문서 내용의 논리적 흐름과 일관성 유지
- 문서 간 내용 이동 시 맥락 유지
- 새로운 내용은 추가하지 않고 기존 내용만 재배치

포맷팅 규칙:
- 주요 섹션은 # 또는 ## 헤더로 명확히 구분
- 소제목과 중요 개념은 ### 또는 #### 수준의 헤더로 구분
- 중요 개념이나 키워드는 **볼드체**로 강조
- 정의나 특별한 용어는 *이탤릭체*로 표시
- 핵심 아이디어나 중요 포인트는 ==하이라이트==로 강조
- 목록이 필요한 경우 불릿 포인트(-) 또는 번호 목록(1., 2.)을 적절히 활용
- 복잡한 정보는 표 형식으로 구조화
- 인용이 필요한 경우 > 블록인용구 활용`;

        // 노트 내용 결합
        let notesDescription = '';
        for (let i = 0; i < notes.length; i++) {
            notesDescription += `\n\n문서 ${i + 1}:
제목: ${notes[i].title}
내용:
${notes[i].content}`;
        }

        const userPrompt = `${systemPrompt}

다음은 내용을 재배치할 문서들입니다:${notesDescription}

위 문서들의 내용을 분석하여 각 문서의 제목에 가장 적합한 내용을 재배치해주세요. 예를 들어, 사과에 대한 문서, 바나나에 대한 문서, 오이에 대한 문서가 있다면, 사과 문서에 있는 바나나나 오이 관련 내용은 해당 문서로 옮기고, 사과 문서는 사과 관련 내용만 남겨주세요.

새로운 내용은 추가하지 말고, 기존 내용만 재배치해주세요. 모든 문서의 내용을 분석하여 각 제목에 맞는 내용이 해당 문서에 포함되도록 해주세요.

결과는 반드시 다음 JSON 형식으로 반환하세요:
\`\`\`json
{
  "noteContents": [
    "문서 1의 조정된 내용",
    "문서 2의 조정된 내용",
    "문서 3의 조정된 내용"
    // 순서는 입력된 문서 순서와 동일하게
  ]
}
\`\`\`

분할 결과를 위 JSON 형식으로만 반환하고, 추가 설명이나 다른 형식은 포함하지 마세요.`;

        const response = await requestToAI(this.plugin, {
            userPrompt
        });

        try {
            // JSON 형식 추출
            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                             response.match(/```\n([\s\S]*?)\n```/) ||
                             [null, response];
            
            const jsonContent = jsonMatch ? jsonMatch[1] : response;
            const parsedResult = JSON.parse(jsonContent);
            
            return {
                noteContents: parsedResult.noteContents || []
            };
        } catch (error) {
            console.error('AI 응답 파싱 오류:', error);
            throw new Error('AI 응답을 처리할 수 없습니다. 응답 형식이 올바르지 않습니다.');
        }
    }
}
