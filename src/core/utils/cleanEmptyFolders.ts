import { App, Notice, TFolder } from 'obsidian';
import type AILSSPlugin from '../../../main';
import { PathSettings } from '../settings/pathSettings';

export class CleanEmptyFolders {
    private static readonly DEACTIVATED_ROOT = PathSettings.DEACTIVATED_ROOT;
    private app: App;
    private readonly MAX_DEPTH = PathSettings.MAX_FOLDER_DEPTH;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
    }

    async cleanEmptyFoldersInVault(): Promise<void> {
        try {
            const emptyFolders = await this.findEmptyFolders();
            
            if (emptyFolders.length === 0) {
                new Notice("삭제할 빈 폴더가 없습니다.");
                return;
            }

            for (const folder of emptyFolders) {
                await this.app.vault.delete(folder);
            }
            new Notice(`${emptyFolders.length}개의 빈 폴더가 정리되었습니다.`);
        } catch (error) {
            console.error("Error cleaning empty folders:", error);
            new Notice("빈 폴더 정리 중 오류가 발생했습니다.");
        }
    }

    private async findEmptyFolders(): Promise<TFolder[]> {
        const emptyFolders: TFolder[] = [];
        const rootFolder = this.app.vault.getRoot();
        await this.processFolder(rootFolder, 0, emptyFolders);
        return emptyFolders;
    }

    private async processFolder(folder: TFolder, depth: number, emptyFolders: TFolder[]): Promise<boolean> {
        if (depth >= this.MAX_DEPTH) return false;
        
        // deactivated 폴더는 처리하지 않음
        if (folder.path === CleanEmptyFolders.DEACTIVATED_ROOT) {
            return false;
        }

        // 하위 폴더 처리
        let allSubfoldersEmpty = true;
        for (const child of folder.children) {
            if (child instanceof TFolder) {
                const isEmpty = await this.processFolder(child, depth + 1, emptyFolders);
                if (!isEmpty) {
                    allSubfoldersEmpty = false;
                }
            } else {
                // 파일이 있으면 이 폴더는 비어있지 않음
                allSubfoldersEmpty = false;
            }
        }

        // 모든 하위 폴더가 비어있고 파일이 없는 경우 이 폴더는 비어있음
        if (allSubfoldersEmpty && folder.children.length === 0 && folder.path !== '/') {
            emptyFolders.push(folder);
            return true;
        }

        return false;
    }
}
