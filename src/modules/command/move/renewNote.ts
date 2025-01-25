import { App, TFile, Notice } from 'obsidian';
import { moment } from 'obsidian';
import type AILSSPlugin from 'main';
import { PathSettings } from '../../maintenance/settings/pathSettings';
import { FrontmatterManager } from '../../maintenance/utils/frontmatterManager';
import { CleanEmptyFolders } from '../../maintenance/utils/cleanEmptyFolders';

export class RenewNote {
    private app: App;
    private plugin: AILSSPlugin;
    private frontmatterManager: FrontmatterManager;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.frontmatterManager = new FrontmatterManager();
    }

    async renewCurrentNote(): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('열린 노트가 없습니다.');
            return;
        }

        try {
            await this.renewNote(activeFile);
            new Notice('노트가 갱신되었습니다.');
        } catch (error) {
            console.error('노트 갱신 중 오류 발생:', error);
            new Notice('노트 갱신 중 오류가 발생했습니다.');
        }
    }

    private async renewNote(file: TFile): Promise<void> {
        const now = moment();
        const newPath = PathSettings.getTimestampedPath(now);
        const attachments = await this.getLinkedAttachments(file);
        
        // 새 경로에서 사용할 노트 이름 생성
        const { newNoteName, newNotePath } = await this.generateNewNotePath(file, newPath);
        
        // 첨부파일들의 새 경로 생성
        const attachmentMoves = await this.generateAttachmentPaths(attachments, newNoteName, newPath);
        
        // 프론트매터 업데이트
        const content = await this.app.vault.read(file);
        const updatedContent = this.frontmatterManager.updateFrontmatter(content, {
            Activated: now.format('YYYY-MM-DD HH:mm'),
            Potentiation: FrontmatterManager.INITIAL_POTENTIATION
        });

        // 파일 이동 실행
        await this.app.vault.rename(file, newNotePath);
        await this.app.vault.modify(file, updatedContent);
        
        // 첨부파일들 이동
        for (const [attachment, newPath] of attachmentMoves) {
            await this.app.vault.rename(attachment, newPath);
        }

        // 빈 폴더 정리
        const cleaner = new CleanEmptyFolders(this.app, this.plugin);
        await cleaner.cleanEmptyFoldersInVault();
    }

    private async getLinkedAttachments(file: TFile): Promise<TFile[]> {
        const content = await this.app.vault.read(file);
        const attachmentLinks = content.match(/!\[\[(.*?)\]\]/g) || [];
        const attachments: TFile[] = [];

        for (const link of attachmentLinks) {
            const path = link.slice(3, -2).split('|')[0];
            const attachment = this.app.vault.getAbstractFileByPath(path);
            if (attachment instanceof TFile) {
                attachments.push(attachment);
            }
        }

        return attachments;
    }

    private async generateNewNotePath(file: TFile, newPath: string): Promise<{ newNoteName: string, newNotePath: string }> {
        let index = 0;
        let newNoteName = file.basename;
        let newNotePath = `${newPath}/${newNoteName}${file.extension}`;

        while (this.app.vault.getAbstractFileByPath(newNotePath)) {
            index++;
            newNoteName = `${file.basename}-${index}`;
            newNotePath = `${newPath}/${newNoteName}${file.extension}`;
        }

        return { newNoteName, newNotePath };
    }

    private async generateAttachmentPaths(attachments: TFile[], noteName: string, newPath: string): Promise<Map<TFile, string>> {
        const moves = new Map<TFile, string>();
        let index = 1;

        for (const attachment of attachments) {
            const newName = `${noteName}-${index}.${attachment.extension}`;  // 개발-1-1.png 형식
            moves.set(attachment, `${newPath}/${newName}`);
            index++;
        }

        return moves;
    }
}
