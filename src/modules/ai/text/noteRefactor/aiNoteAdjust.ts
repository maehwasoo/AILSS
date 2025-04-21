import { App, TFile, Notice } from 'obsidian';
import AILSSPlugin from '../../../../../main';
import { requestToAI } from '../../ai_utils/aiUtils';
import { FrontmatterManager } from '../../../../core/utils/frontmatterManager';
import { 
    getContentWithoutFrontmatter, 
    prepareLinksForAI,
    restoreLinksFromAI,
    LinkInfo
} from '../../../../core/utils/contentUtils';
import { FORMATTING_RULES, NoteResult, NoteInfo, CoreDependencies } from './types';

export class AINoteAdjust {
    private app: App;
    private plugin: AILSSPlugin;
    private frontmatterManager: FrontmatterManager;
    
    constructor({ app, plugin }: CoreDependencies) {
        this.app = app;
        this.plugin = plugin;
        this.frontmatterManager = new FrontmatterManager();
    }

    /**
     * 여러 노트 간의 내용을 주제에 따라 재조정합니다.
     * @param mainFile 메인 노트
     * @param otherFiles 다른 노트들
     * @param applyChanges 변경사항을 즉시 적용할지 여부 (기본값: false)
     * @returns 변경될 노트들의 정보
     */
    async adjustNotes(
        mainFile: TFile, 
        otherFiles: TFile[], 
        applyChanges: boolean = false
    ): Promise<Array<NoteResult>> {
        try {
            // 모든 노트의 내용 및 메타데이터 수집
            const allNotes: NoteInfo[] = [];
            
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
            
            // 노트 업데이트 정보 수집
            const updatedNotes = [];
            
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
                
                // 업데이트 정보 저장
                updatedNotes.push({
                    file: note.file,
                    title: note.title,
                    originalContent: note.content,
                    newContent: finalContent,
                    frontmatter: updatedFrontmatter
                });
            }
            
            // 변경사항 즉시 적용 옵션이 활성화된 경우에만 적용
            if (applyChanges) {
                // 각 노트 업데이트
                for (const note of updatedNotes) {
                    await this.app.vault.modify(note.file, note.newContent);
                }
                
                new Notice(`노트 조정이 완료되었습니다. ${updatedNotes.length}개의 노트가 업데이트되었습니다.`);
            }
            
            return updatedNotes;
        } catch (error: any) {
            console.error('노트 조정 중 오류 발생:', error);
            throw new Error(`노트 조정 중 오류 발생: ${error.message}`);
        }
    }

    /**
     * 노트 조정을 위한 AI 처리를 수행합니다.
     */
    private async adjustingAIProcess(
        notes: NoteInfo[]
    ): Promise<{
        noteContents: string[];
    }> {
        // 각 노트의 내용을 처리하고 모든 링크 플레이스홀더 수집
        let notesDescription = '';
        // 명시적인 타입 선언 추가
        const allLinkPlaceholders: {
            placeholder: string;
            originalLink: string;
            linkInfo: LinkInfo;
        }[] = [];
        const processedNotes = [];
        
        for (let i = 0; i < notes.length; i++) {
            // 링크를 플레이스홀더로 대체
            const { modifiedContent, linkPlaceholders } = prepareLinksForAI(notes[i].content);
            
            // 처리된 내용 저장
            processedNotes.push({
                ...notes[i],
                processedContent: modifiedContent
            });
            
            // 모든 링크 플레이스홀더 수집
            allLinkPlaceholders.push(...linkPlaceholders);
            
            // 노트 설명 추가
            notesDescription += `\n\n문서 ${i + 1}:
제목: ${notes[i].title}
내용:
${modifiedContent}`;
        }

        const combinedPrompt = `당신은 문서 내용 최적화 및 재배치 전문가입니다.
여러 문서의 내용을 분석하여 각 문서의 주제에 맞게 내용을 재배치합니다.

조정 원칙:
- 각 문서의 제목과 관련된 내용만 해당 문서에 유지
- 다른 주제에 더 적합한 내용은 해당 주제의 문서로 이동
- 정보의 손실 없이 모든 내용이 가장 적합한 문서에 배치
- 중복 내용 제거 및 유사 내용 통합
- 각 문서 내용의 논리적 흐름과 일관성 유지
- 문서 간 내용 이동 시 맥락 유지
- 새로운 내용은 추가하지 않고 기존 내용만 재배치
- 모든 내부 링크(Obsidian 링크) 형식은 반드시 보존 (예: [[노트명|별칭]], ![[첨부파일|별칭]])
${FORMATTING_RULES}

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
            combinedPrompt
        });

        try {
            // JSON 형식 추출
            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                             response.match(/```\n([\s\S]*?)\n```/);
            
            // jsonMatch가 있으면 그 안의 내용 사용, 없으면 전체 응답 사용
            const jsonContent = jsonMatch && jsonMatch[1] ? jsonMatch[1] : response;
            const parsedResult = JSON.parse(jsonContent);
            
            // 응답에서 플레이스홀더를 원래 링크로 복원
            const restoredNoteContents = (parsedResult.noteContents || []).map(
                (content: string) => restoreLinksFromAI(content, allLinkPlaceholders)
            );
            
            return {
                noteContents: restoredNoteContents
            };
        } catch (error) {
            console.error('AI 응답 파싱 오류:', error);
            throw new Error('AI 응답을 처리할 수 없습니다. 응답 형식이 올바르지 않습니다.');
        }
    }
}