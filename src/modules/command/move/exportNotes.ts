import { App, Notice, TFile, Modal } from 'obsidian';
import { showConfirmationDialog } from '../../../components/confirmationModal';
import { showTagSelectionDialog } from '../../../components/tagSelectionModal';
import { CleanEmptyFolders } from '../../maintenance/utils/cleanEmptyFolders';
import type AILSSPlugin from '../../../../main';
import { PathSettings } from '../../maintenance/settings/pathSettings';

export class ExportNotes {
    private static readonly EXPORT_ROOT = 'export';
    
    private app: App;
    private plugin: AILSSPlugin;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async exportNotesByTag(): Promise<void> {
        try {
            const tags = await showTagSelectionDialog(this.app, {
                title: "내보낼 태그 선택",
                placeholder: "태그를 선택하세요",
                confirmText: "선택",
                cancelText: "취소"
            });
            if (!tags || tags.length === 0) {
                new Notice("태그가 선택되지 않았습니다.");
                return;
            }

            const notesToExport = this.findNotesByTags(tags);
            if (notesToExport.size === 0) {
                new Notice("선택한 태그를 가진 노트를 찾을 수 없습니다.");
                return;
            }

            const confirmed = await showConfirmationDialog(this.app, {
                title: "내보내기 확인",
                message: `선택한 태그(${tags.join(', ')})를 가진 ${notesToExport.size}개의 노트를 프론트매터 없이 내보내시겠습니까?`,
                confirmText: "내보내기",
                cancelText: "취소"
            });

            if (!confirmed) {
                new Notice("작업이 취소되었습니다.");
                return;
            }

            let processedCount = 0;
            for (const note of notesToExport) {
                try {
                    await this.exportNoteWithoutFrontmatter(note, tags);
                    processedCount++;
                    new Notice(`진행 상황: ${processedCount}/${notesToExport.size}`);
                } catch (error) {
                    console.error(`Error processing note ${note.path}:`, error);
                    new Notice(`노트 처리 중 오류 발생: ${note.basename}`);
                }
            }

            new Notice("모든 노트가 성공적으로 내보내졌습니다.");
        } catch (error) {
            console.error("Error in exportNotesByTag:", error);
            new Notice(`오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async ensureExportFolder(): Promise<void> {
        if (!(await this.app.vault.adapter.exists(ExportNotes.EXPORT_ROOT))) {
            await this.app.vault.createFolder(ExportNotes.EXPORT_ROOT);
        }
    }

    private async exportNoteWithoutFrontmatter(note: TFile, tags: string[]): Promise<void> {
        const mainTag = tags[0].replace(/^#/, '').replace(/\//g, '-');
        
        // 내보내기 경로 구성
        const exportPath = `${ExportNotes.EXPORT_ROOT}/${mainTag}`;
        
        await this.ensureExportFolder();
        await this.createFolderIfNotExists(exportPath);

        // 노트 내용 읽기
        const content = await this.app.vault.read(note);
        
        // 프론트매터 제거
        const contentWithoutFrontmatter = this.removeFrontmatter(content);
        
        // 새 파일 경로
        const newPath = `${exportPath}/${note.basename}`;
        
        // 내용만 내보내기
        await this.app.vault.create(newPath, contentWithoutFrontmatter);
    }

    private removeFrontmatter(content: string): string {
        // YAML 프론트매터 제거
        const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
        return content.replace(frontmatterRegex, '').trim();
    }

    private async createFolderIfNotExists(path: string): Promise<void> {
        if (!(await this.app.vault.adapter.exists(path))) {
            await this.app.vault.createFolder(path);
        }
    }

    private findNotesByTags(tags: string[]): Set<TFile> {
        const notesToExport = new Set<TFile>();
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
                    notesToExport.add(file);
                }
            }
        }
        
        return notesToExport;
    }
}