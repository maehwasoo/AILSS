import { App, Notice, TFile } from 'obsidian';
import type AILSSPlugin from '../../../../main';
import { showConfirmationDialog } from '../../../components/commonUI/confirmationModal';
import { CleanEmptyFolders } from '../../../core/utils/cleanEmptyFolders';
import { PathSettings } from '../../../core/settings/pathSettings';

export class DeleteAttachment {
    private app: App;
    private plugin: AILSSPlugin;
    private cleanEmptyFolders: CleanEmptyFolders;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.cleanEmptyFolders = new CleanEmptyFolders(this.app, this.plugin);
    }

    async deleteLink() {
        try {
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                new Notice('활성화된 노트가 없습니다.');
                return;
            }

            // 현재 노트의 디렉토리 경로 가져오기
            const currentDir = activeFile.parent?.path || "";

            const editor = this.app.workspace.activeEditor?.editor;
            if (!editor) {
                new Notice('에디터를 찾을 수 없습니다.');
                return;
            }

            const selectedText = editor.getSelection();
            if (!selectedText) {
                new Notice('텍스트가 선택되지 않았습니다.');
                return;
            }

            // 첨부파일 링크만 찾기
            const links = this.findAllLinks(selectedText);
            const attachmentLinks = links.filter(link => link.type === 'attachment');
            
            if (attachmentLinks.length === 0) {
                new Notice('선택된 텍스트에서 첨부파일 링크를 찾을 수 없습니다.');
                return;
            }

            // 삭제할 파일 정보 수집
            const filesToDelete: Array<{file: TFile | null, originalText: string}> = [];
            
            for (const link of attachmentLinks) {
                const match = link.text.match(/!\[\[(.*?)\]\]/);
                if (match) {
                    const fileName = match[1].trim();
                    // 현재 디렉토리 경로와 파일명을 결합
                    const fullPath = currentDir ? `${currentDir}/${fileName}` : fileName;
                    const file = this.app.vault.getAbstractFileByPath(fullPath);
                    filesToDelete.push({
                        file: file instanceof TFile ? file : null,
                        originalText: link.text
                    });
                }
            }

            if (filesToDelete.length > 0) {
                const existingFiles = filesToDelete.filter(f => f.file !== null);

                const confirmMessage = existingFiles.length > 0
                    ? `${existingFiles.length}개의 첨부파일을 삭제하시겠습니까?\n\n${existingFiles.map(f => `- ${f.file?.path}`).join('\n')}`
                    : "선택된 첨부파일 링크를 제거하시겠습니까?";

                const confirmed = await showConfirmationDialog(this.app, {
                    title: "첨부파일 삭제 확인",
                    message: confirmMessage,
                    confirmText: "삭제",
                    cancelText: "취소"
                });

                if (!confirmed) {
                    new Notice("작업이 취소되었습니다.");
                    return;
                }

                // 파일 삭제 및 링크 텍스트 처리
                let modifiedText = selectedText;
                for (const {file, originalText} of filesToDelete) {
                    let fileDeleted = false;

                    if (file) {
                        try {
                            await this.app.vault.delete(file);
                            fileDeleted = true;
                        } catch (error) {
                            try {
                                await this.app.vault.trash(file, false);
                                fileDeleted = true;
                            } catch (trashError) {
                                new Notice(`${file.path} 삭제 실패`);
                                continue;
                            }
                        }
                    }

                    if (!file || fileDeleted) {
                        modifiedText = modifiedText.replace(originalText, '');
                    }
                }

                editor.replaceSelection(modifiedText);
                
                const message = existingFiles.length > 0
                    ? `${existingFiles.length}개의 첨부파일이 삭제되었습니다.`
                    : "첨부파일 링크가 제거되었습니다.";
                new Notice(message);
                await this.cleanEmptyFolders.cleanEmptyFoldersInVault();
            } else {
                new Notice('삭제할 첨부파일을 찾을 수 없습니다.');
            }
        } catch (error) {
            new Notice('작업 실패: ' + error.message);
        }
    }

    private findAllLinks(text: string): Array<{text: string, type: 'attachment'}> {
        const links: Array<{text: string, type: 'attachment'}> = [];
        
        // 첨부파일 링크만 찾습니다 (![[...]])
        const regex = /!\[\[(.*?)\]\]/g;
        let match;
        
        while ((match = regex.exec(text)) !== null) {
            const filePath = match[1].trim();
            // 일반적인 첨부파일 확장자 체크
            if (this.isAttachmentFile(filePath)) {
                links.push({text: match[0], type: 'attachment'});
            }
        }

        return links;
    }

    private isAttachmentFile(filePath: string): boolean {
        // 일반적인 첨부파일 확장자 목록
        const attachmentExtensions = [
            '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg',
            '.mp3', '.wav', '.m4a', '.ogg', '.3gp', '.flac',
            '.mp4', '.webm', '.ogv', '.mov', '.mkv',
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
            '.zip', '.rar', '.7z'
        ];
        
        return attachmentExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
    }

    private identifyLinkType(text: string): 'note' | 'attachment' | null {
        if (text.match(/!\[\[.*?\]\]/)) return 'attachment';
        if (text.match(/\[\[.*?\]\]/)) return 'note';
        return null;
    }

    private extractFilePath(text: string, type: 'note' | 'attachment', currentPath: string): string | null {
        let match;
        if (type === 'attachment') {
            match = text.match(/!\[\[(.*?)\]\]/);
            if (match) {
                const filePath = match[1];
                if (PathSettings.isValidPath(filePath)) {
                    return filePath;
                }
                const currentDir = currentPath.substring(0, currentPath.lastIndexOf('/'));
                return `${currentDir}/${filePath}`;
            }
        } else {
            // 노트 링크에서 파일 경로 추출 (파이프 기호 앞의 부분)
            match = text.match(/\[\[([^|]+)\|/);
            if (match) {
                let filePath = match[1].trim();
                // 파일 확장자가 없는 경우에만 추가
                if (!filePath.endsWith('.md')) {
                    filePath += '.md';
                }
                return filePath;
            }
        }
        return null;
    }
}
