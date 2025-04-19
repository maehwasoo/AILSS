import { App, Notice, TFile } from 'obsidian';
import { showConfirmationDialog } from '../../../components/commonUI/confirmationModal';
import { showTagSelectionDialog } from '../../../components/tagUI/tagSelectionModal';
import { CleanEmptyFolders } from '../../../core/utils/cleanEmptyFolders';
import type AILSSPlugin from '../../../../main';
import { PathSettings } from '../../../core/settings/pathSettings';
export class DeactivateNotes {
    private static readonly DEACTIVATED_ROOT = PathSettings.DEACTIVATED_ROOT;
    
    private app: App;
    private plugin: AILSSPlugin;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async deactivateNotesByTag(): Promise<void> {
        try {
            const tags = await showTagSelectionDialog(this.app, {
                title: "비활성화할 태그 선택",
                placeholder: "태그를 선택하세요",
                confirmText: "선택",
                cancelText: "취소"
            });
            if (!tags || tags.length === 0) {
                new Notice("태그가 선택되지 않았습니다.");
                return;
            }

            const notesToDeactivate = this.findNotesByTags(tags);
            if (notesToDeactivate.size === 0) {
                new Notice("선택한 태그를 가진 노트를 찾을 수 없습니다.");
                return;
            }

            const confirmed = await showConfirmationDialog(this.app, {
                title: "비활성화 확인",
                message: `선택한 태그(${tags.join(', ')})를 가진 ${notesToDeactivate.size}개의 노트를 비활성화하시겠습니까?`,
                confirmText: "비활성화",
                cancelText: "취소"
            });

            if (!confirmed) {
                new Notice("작업이 취소되었습니다.");
                return;
            }

            let processedCount = 0;
            for (const note of notesToDeactivate) {
                try {
                    await this.moveNoteToDeactivateFolder(note, tags);
                    processedCount++;
                    new Notice(`진행 상황: ${processedCount}/${notesToDeactivate.size}`);
                } catch (error) {
                    console.error(`Error processing note ${note.path}:`, error);
                    new Notice(`노트 처리 중 오류 발생: ${note.basename}`);
                }
            }

            // 빈 폴더 정리
            const cleanEmptyFolders = new CleanEmptyFolders(this.app, this.plugin);
            await cleanEmptyFolders.cleanEmptyFoldersInVault();

            new Notice("모든 노트가 비활성화되었습니다.");
        } catch (error) {
            console.error("Error in deactivateNotesByTag:", error);
            new Notice(`오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async ensureDeactivatedFolder(): Promise<void> {
        if (!(await this.app.vault.adapter.exists(DeactivateNotes.DEACTIVATED_ROOT))) {
            await this.app.vault.createFolder(DeactivateNotes.DEACTIVATED_ROOT);
        }
    }

    private async moveNoteToDeactivateFolder(note: TFile, tags: string[]): Promise<void> {
        const mainTag = tags[0].replace(/^#/, '').replace(/\//g, '-');
        
        // 원본 경로에서 시간 구조 추출 수정
        const pathParts = note.path.split('/');
        const timeStructure = pathParts
            .filter(part => /^\d{4}$|\d{2}$/.test(part)) // YYYY, MM, DD 형식만 필터링
            .slice(0, 3)  // YYYY/MM/DD 형식만 유지
            .join('/');
        
        // 비활성화 경로 구성
        const deactivatePath = `${DeactivateNotes.DEACTIVATED_ROOT}/${mainTag}/${timeStructure}`;
        
        await this.ensureDeactivatedFolder();
        await this.createFolderIfNotExists(deactivatePath);

        // 노트 내용 읽기
        const content = await this.app.vault.read(note);
        
        // 첨부파일 찾기 및 이동
        const attachmentRegex = /!\[\[(.*?)\]\]/g;
        let match;

        // 현재 노트의 디렉토리 경로
        const currentDir = note.parent?.path || '';

        while ((match = attachmentRegex.exec(content)) !== null) {
            const attachmentName = match[1];
            const attachmentPath = currentDir ? `${currentDir}/${attachmentName}` : attachmentName;
            const attachmentFile = this.app.vault.getAbstractFileByPath(attachmentPath);

            if (attachmentFile instanceof TFile) {
                const newAttachmentPath = `${deactivatePath}/${attachmentFile.name}`;
                await this.app.vault.rename(attachmentFile, newAttachmentPath);
            }
        }

        // 노트 이동 (원본 파일명 유지)
        const newPath = `${deactivatePath}/${note.name}`;
        await this.app.vault.rename(note, newPath);
    }

    private async createFolderIfNotExists(path: string): Promise<void> {
        if (!(await this.app.vault.adapter.exists(path))) {
            await this.app.vault.createFolder(path);
        }
    }

    private findNotesByTags(tags: string[]): Set<TFile> {
        const notesToDeactivate = new Set<TFile>();
        const files = this.app.vault.getMarkdownFiles();
        
        // '#' 제거하고 정규화
        const normalizedTags = tags.map(tag => tag.startsWith('#') ? tag.substring(1) : tag);
        
        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatterTags = cache?.frontmatter?.tags;
            
            if (Array.isArray(frontmatterTags)) {
                // 각 노트의 태그가 입력된 태그와 정확히 일치하거나
                // 입력된 태그 + '/'로 시작하는 경우를 포함하면 노트를 추가
                if (
                    frontmatterTags.some((fileTag: string) =>
                        normalizedTags.some(normalized =>
                            fileTag === normalized || fileTag.startsWith(`${normalized}/`)
                        )
                    )
                ) {
                    notesToDeactivate.add(file);
                }
            }
        }
        
        return notesToDeactivate;
    }
}