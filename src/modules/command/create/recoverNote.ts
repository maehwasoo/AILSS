import { App, Notice, MarkdownView, TFile, Editor } from 'obsidian';
import type AILSSPlugin from 'main';
import { PathSettings } from '../../../core/settings/pathSettings';
import { CleanEmptyFolders } from '../../../core/utils/cleanEmptyFolders';
import { RemoveNoteLinks } from '../delete/removeNoteLinks';

export class RecoverNote {
    private removeNoteLinks: RemoveNoteLinks;

    constructor(
        private app: App,
        private plugin: AILSSPlugin
    ) {
        this.removeNoteLinks = new RemoveNoteLinks(this.app);
    }

    async recoverNote() {
        try {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView) {
                throw new Error("활성화된 마크다운 뷰가 없습니다.");
            }

            const editor = activeView.editor;
            const selectedText = editor.getSelection();
            const originalSelection = editor.getSelection(); // 원본 선택 텍스트 저장

            if (!selectedText) {
                throw new Error("텍스트가 선택되지 않았습니다.");
            }

            // 링크 정보 추출
            const linkInfo = this.extractLinkInfo(selectedText);
            if (!linkInfo) {
                throw new Error("선택된 텍스트에서 유효한 링크를 찾을 수 없습니다.");
            }

            // 파일 경로 확인 및 파일 찾기
            if (!activeView.file) {
                throw new Error("현재 파일을 찾을 수 없습니다.");
            }
            const linkedFileResult = await this.findLinkedFile(linkInfo.id, activeView.file);
            if (!linkedFileResult) {
                throw new Error(`링크된 파일을 찾을 수 없습니다: ${linkInfo.id}`);
            }
            const linkedFile = linkedFileResult;  // TypeScript는 이제 이것이 null이 아님을 알게 됩니다

            // 링크된 파일의 내용 가져오기 (이제 linkedFile은 확실히 TFile 타입)
            const linkedContent = await this.app.vault.read(linkedFile);
            const contentWithoutFrontmatter = this.removeFrontmatter(linkedContent);
            const formattedContent = this.formatContent(contentWithoutFrontmatter, editor);

            // 백링크 처리 및 파일 삭제를 먼저 수행
            await this.removeNoteLinks.removeLinksToFile(linkedFile);
            await this.app.vault.trash(linkedFile, true);
            await this.cleanEmptyFolders(linkedFile.path);

            // 마지막으로 에디터 내용 교체
            editor.replaceSelection(formattedContent);
            
            // 변경사항이 적용되도록 약간의 지연 후 알림
            setTimeout(() => {
                new Notice("링크가 복구되었고 연결된 노트가 삭제되었습니다.");
            }, 100);

        } catch (error) {
            console.error("오류 발생:", error);
            new Notice(`오류: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private extractLinkInfo(text: string): { id: string, title: string, isEmbed: boolean } | null {
        const match = text.match(/(!?)\[\[((\d{14})\|(.+?))\]\]/);
        if (!match) return null;
        return {
            id: match[3],
            title: match[4],
            isEmbed: match[1] === '!'
        };
    }

    private async findLinkedFile(id: string, currentFile: TFile): Promise<TFile | null> {
        // YYYY/MM/DD 형식의 경로 추출
        const year = id.substring(0, 4);
        const month = id.substring(4, 6);
        const day = id.substring(6, 8);
        const datePath = `${year}/${month}/${day}`;

        // 1. 날짜 기반 경로에서 파일 찾기
        const dateBasedPath = `${datePath}/${id}${PathSettings.DEFAULT_FILE_EXTENSION}`;
        let file = this.app.vault.getAbstractFileByPath(dateBasedPath);
        if (file instanceof TFile) return file;
        
        if (currentFile?.parent) {
            const currentFolder = currentFile.parent;
            const sameDirectoryPath = `${currentFolder.path}/${id}${PathSettings.DEFAULT_FILE_EXTENSION}`;
            file = this.app.vault.getAbstractFileByPath(sameDirectoryPath);
            if (file instanceof TFile) return file;
        }

        return null;
    }

    private removeFrontmatter(content: string): string {
        return content.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    }

    private formatContent(content: string, editor: Editor): string {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const currentIndent = line.match(/^\s*/)?.[0] || '';

        const contentLines = content.split('\n');
        return contentLines.map((contentLine, index) => {
            if (index === 0) {
                return `- ${contentLine.replace(/^[-*+]\s+/, '')}`;
            }
            return `${currentIndent}${contentLine}`;
        }).join('\n');
    }

    private async cleanEmptyFolders(filePath: string): Promise<void> {
        const cleanEmptyFolders = new CleanEmptyFolders(this.app, this.plugin);
        await cleanEmptyFolders.cleanEmptyFoldersInVault();
    }
}
