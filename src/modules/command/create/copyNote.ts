import { App, Notice, MarkdownView, moment, TFile } from 'obsidian';
import type AILSSPlugin from 'main';
import { FrontmatterManager } from '../../../core/utils/frontmatterManager';
import { PathSettings } from '../../../core/settings/pathSettings';
import { FrontmatterSearchUtils } from '../../../core/utils/frontmatterSearchUtils';
import { showTitleSearchModal } from '../../../components/commonUI/titleSearchModal';

export class CopyNote {
    constructor(
        private app: App,
        private plugin: AILSSPlugin
    ) {}

    async createCopyNote() {
        try {
            // 노트 개수 제한 확인
            if (!(await PathSettings.checkNoteLimit(this.app, this.plugin))) {
                new Notice(`노트 개수가 최대 제한(${PathSettings.MAX_NOTES}개)에 도달했습니다.`);
                return;
            }

            // 현재 활성화된 에디터와 선택된 텍스트 가져오기
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView) {
                throw new Error("활성화된 마크다운 뷰가 없습니다.");
            }

            const editor = activeView.editor;
            const cursor = editor.getCursor('from');
            const firstLine = editor.getLine(cursor.line);
            const baseIndentLength = firstLine.match(/^(\s*)/)?.[1].length ?? 0;
            const lines: string[] = [];
            const adjustedLines: string[] = [];

            for (let lineNum = cursor.line; lineNum < editor.lineCount(); lineNum++) {
                const lineText = editor.getLine(lineNum);
                const indentLength = lineText.match(/^(\s*)/)?.[1].length ?? 0;

                if (lineNum === cursor.line || indentLength > baseIndentLength) {
                    lines.push(lineText);
                    adjustedLines.push(lineText.substring(baseIndentLength));
                } else {
                    break;
                }
            }

            const selectedText = adjustedLines.join('\n');
            
            // 선택된 텍스트가 없는지 확인
            if (!selectedText) {
                new Notice("텍스트를 선택해주세요.");
                return;
            }
            
            // 실제 에디터에서 선택된 텍스트 가져오기
            const selection = editor.getSelection();
            // 선택된 텍스트가 있으면 그 텍스트를 title로 사용, 없으면 첫 줄 사용
            const titleText = selection ? selection.trim() : selectedText.split('\n')[0].trim();
            // 리스트 마커 제거
            const cleanedTitleText = titleText.replace(/^[-*+]\s+/, '');

            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                throw new Error("현재 열린 파일을 찾을 수 없습니다.");
            }

            // 현재 노트의 frontmatter에서 태그 가져오기
            const frontmatterManager = new FrontmatterManager();
            const currentContent = await this.app.vault.read(activeFile);
            const currentFrontmatter = frontmatterManager.parseFrontmatter(currentContent);
            const currentTags = currentFrontmatter?.tags || [];

            // 기본 태그만 있는지 확인
            if (FrontmatterManager.hasOnlyDefaultTags(currentTags)) {
                new Notice("현재 노트에 기본 태그 외의 태그가 없습니다. 태그를 추가해주세요.");
                return;
            }

            // 기본 태그를 제외한 태그만 가져오기
            const nonDefaultTags = FrontmatterManager.getNonDefaultTags(currentTags);

            // 중복 노트 검색 및 모달 표시
            const modalResult = await FrontmatterSearchUtils.searchAndShowModal(
                this.app,
                cleanedTitleText
            );

            // 모달 결과에 따라 처리
            if (modalResult) {
                if (modalResult.action === 'select' && modalResult.selectedFile) {
                    // 기존 노트 선택 시 링크만 생성
                    return await this.createLinkToExistingNote(
                        editor, 
                        selection || cleanedTitleText,
                        modalResult.selectedFile
                    );
                } else if (modalResult.action === 'cancel') {
                    // 취소 선택 시 종료
                    return;
                }
                // 'create' 액션은 아래로 진행해서 새 노트 생성
            }

            // 4. 새 노트 생성 진행
            const now = moment();
            const folderPath = PathSettings.getTimestampedPath(now);
            
            // 파일명을 ID 형식으로 생성
            const fileName = PathSettings.getDefaultFileName();

            // 프론트매터 생성 (상속받은 태그만 포함)
            const noteContent = frontmatterManager.generateFrontmatter({
                title: cleanedTitleText,
                tags: nonDefaultTags
            }, true);

            // 같은 경로에 동일한 파일명이 있는지 확인
            if (await this.app.vault.adapter.exists(`${folderPath}/${fileName}`)) {
                new Notice(`이미 "${cleanedTitleText}" 노트가 해당 경로에 존재합니다.`);
                return;
            }

            // 폴더 생성
            if (!(await this.app.vault.adapter.exists(folderPath))) {
                await this.app.vault.createFolder(folderPath);
            }

            // 노트 생성
            const { file, fileName: createdFileName } = await PathSettings.createNote({
                app: this.app,
                frontmatterConfig: {
                    title: cleanedTitleText,
                    tags: nonDefaultTags
                },
                content: selectedText,
                isInherited: true
            });

            // 선택된 텍스트만 링크로 변경
            const cleanedSelection = selection ? selection.replace(/^[-*+]\s+/, '') : cleanedTitleText;  // 리스트 마커 제거
            
            const fileNameWithoutExtension = createdFileName.replace(PathSettings.DEFAULT_FILE_EXTENSION, '');
            const newLink = `[[${fileNameWithoutExtension}|${cleanedSelection}]]`;
            
            if (selection) {
                editor.replaceSelection(newLink);
            } else {
                // 선택이 없는 경우 커서 위치에 링크 삽입
                editor.replaceRange(newLink, cursor);
            }

            new Notice(`새 노트가 생성되었습니다: ${file.path}`);
            return file;
        } catch (error) {
            new Notice('노트 생성 중 오류가 발생했습니다.');
            console.error('Error creating new note:', error);
            throw error;
        }
    }

    /**
     * 기존 노트로 링크 생성
     */
    private async createLinkToExistingNote(editor: any, selectedText: string, existingFile: TFile): Promise<TFile> {
        const fileNameWithoutExtension = existingFile.basename;
        const newLink = `[[${fileNameWithoutExtension}|${selectedText}]]`;
        
        const selection = editor.getSelection();
        if (selection) {
            editor.replaceSelection(newLink);
        } else {
            // 선택이 없는 경우 커서 위치에 링크 삽입
            const cursor = editor.getCursor('from');
            editor.replaceRange(newLink, cursor);
        }
        
        new Notice(`기존 노트로 링크가 생성되었습니다: ${existingFile.path}`);
        return existingFile;
    }
}
