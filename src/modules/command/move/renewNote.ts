import { App, TFile, Notice } from 'obsidian';
import { moment } from 'obsidian';
import type AILSSPlugin from 'main';
import { PathSettings } from '../../../core/settings/pathSettings';
import { FrontmatterManager } from '../../../core/utils/frontmatterManager';
import { CleanEmptyFolders } from '../../../core/utils/cleanEmptyFolders';

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
            const content = await this.app.vault.read(activeFile);
            const frontmatter = this.frontmatterManager.parseFrontmatter(content);
            
            // potentiation이 7 이상이어야 갱신 가능
            const currentPotentiation = frontmatter?.potentiation ?? 0;
            if (currentPotentiation < 7) {
                new Notice('강화 단계가 7 이상이어야 갱신 가능합니다.');
                return;
            }

            // 생성 후 24시간이 지났는지 확인
            const createDate = frontmatter?.date ? new Date(frontmatter.date) : null;
            if (!createDate) {
                new Notice('노트의 생성일을 확인할 수 없습니다.');
                return;
            }

            const now = new Date();
            const hoursElapsed = (now.getTime() - createDate.getTime()) / (1000 * 60 * 60);
            
            if (hoursElapsed < 24) {
                const hoursRemaining = Math.ceil(24 - hoursElapsed);
                new Notice(`노트 생성 후 24시간이 지나야 갱신 가능합니다. (${hoursRemaining}시간 남음)`);
                return;
            }

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
        
        // 새로운 id 생성 (YYYYMMDDHHmmss 형식)
        const newId = now.format('YYYYMMDDHHmmss');
        
        // 프론트매터 업데이트 - 기존 내용을 유지하면서 필요한 필드만 업데이트
        const content = await this.app.vault.read(file);
        const currentFrontmatter = this.frontmatterManager.parseFrontmatter(content);
        const updatedContent = this.frontmatterManager.updateFrontmatter(content, {
            ...currentFrontmatter,
            id: newId,
            potentiation: FrontmatterManager.INITIAL_POTENTIATION,
            date: now.clone().add(9, 'hours').toISOString().split('.')[0],
            updated: now.clone().add(9, 'hours').toISOString().split('.')[0]
        });

        // 새 경로에서 사용할 노트 이름 생성 (id 기반)
        const { newNotePath } = await this.generateNewNotePathWithId(file, newPath, newId);
        
        // 새 디렉토리가 없으면 생성
        const newDir = newNotePath.substring(0, newNotePath.lastIndexOf('/'));
        if (!(await this.app.vault.adapter.exists(newDir))) {
            await this.app.vault.createFolder(newDir);
        }
        
        // 첨부파일들의 새 경로 생성
        const attachmentMoves = await this.generateAttachmentPaths(attachments, newId, newPath);
        
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

    private async generateNewNotePathWithId(file: TFile, newPath: string, newId: string): Promise<{ newNoteName: string, newNotePath: string }> {
        const newNoteName = newId;
        const newNotePath = `${newPath}/${newNoteName}.${file.extension}`;
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
