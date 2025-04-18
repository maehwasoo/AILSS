import { App, Notice, TFile } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { showConfirmationDialog } from '../../../components/confirmationModal';
import { FrontmatterManager } from '../../maintenance/utils/frontmatterManager';
import { TagSyncModal } from '../../../components/tagSyncModal';

export class UpdateTags {
    private app: App;
    private plugin: AILSSPlugin;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    /**
     * 태그 동기화 모달을 엽니다.
     */
    openTagSyncModal(): void {
        TagSyncModal.openForActiveNote(this.app, this.plugin);
    }

    /**
     * 현재 노트의 태그를 연결된 노트에 적용합니다.
     * 기존 구현과의 호환성을 위해 유지 (replace 모드로 작동)
     */
    async updateCurrentNoteTags(): Promise<void> {
        try {
            const currentFile = this.app.workspace.getActiveFile();
            if (!currentFile) {
                new Notice("활성화된 파일이 없습니다.");
                return;
            }

            const content = await this.app.vault.read(currentFile);
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            
            if (!frontmatterMatch) {
                new Notice("현재 노트에 frontmatter가 없습니다.");
                return;
            }

            const frontmatter = this.parseFrontmatter(frontmatterMatch[1]);
            const tags = frontmatter.tags || [];

            if (!Array.isArray(tags)) {
                new Notice("태그 형식이 올바르지 않습니다.");
                return;
            }

            // 사용자 확인 추가
            const confirmed = await showConfirmationDialog(this.app, {
                title: "태그 업데이트 확인",
                message: `현재 노트의 태그(${tags.join(', ')})를 연결된 모든 노트에 적용하시겠습니까?`,
                confirmText: "업데이트",
                cancelText: "취소"
            });

            if (!confirmed) {
                new Notice("작업이 취소되었습니다.");
                return;
            }

            // 이전 함수를 호출하여 태그 변경 모드로 실행
            const result = await this.replaceTagsInLinkedNotes(currentFile, tags);
            
            if (result) {
                new Notice("태그 업데이트가 완료되었습니다.");
            } else {
                new Notice("태그 업데이트 중 문제가 발생했습니다.");
            }

        } catch (error) {
            console.error("태그 업데이트 중 오류:", error);
            new Notice("태그 업데이트 중 오류가 발생했습니다.");
            return;
        }
    }

    /**
     * 현재 노트의 태그를 연결된 노트에 추가합니다.
     * @param sourceFile 소스 파일
     * @param tags 추가할 태그 배열
     * @returns 성공 여부
     */
    async addTagsToLinkedNotes(sourceFile: TFile, tags: string[]): Promise<boolean> {
        try {
            if (!sourceFile || !tags || tags.length === 0) {
                return false;
            }

            const links = this.app.metadataCache.resolvedLinks[sourceFile.path] || {};
            let updatedCount = 0;
            
            for (const linkedPath of Object.keys(links)) {
                const linkedFile = this.app.vault.getAbstractFileByPath(linkedPath);
                if (linkedFile instanceof TFile) {
                    const updated = await this.addTagsToNote(linkedFile, tags);
                    if (updated) updatedCount++;
                }
            }
            
            console.log(`${updatedCount}개 노트의 태그가 업데이트되었습니다.`);
            return true;
        } catch (error) {
            console.error("태그 추가 중 오류:", error);
            throw error;
        }
    }

    /**
     * 현재 노트의 태그를 연결된 노트에서 삭제합니다.
     * @param sourceFile 소스 파일
     * @param tags 삭제할 태그 배열
     * @returns 성공 여부
     */
    async removeTagsFromLinkedNotes(sourceFile: TFile, tags: string[]): Promise<boolean> {
        try {
            if (!sourceFile || !tags || tags.length === 0) {
                return false;
            }

            const links = this.app.metadataCache.resolvedLinks[sourceFile.path] || {};
            let updatedCount = 0;
            
            for (const linkedPath of Object.keys(links)) {
                const linkedFile = this.app.vault.getAbstractFileByPath(linkedPath);
                if (linkedFile instanceof TFile) {
                    const updated = await this.removeTagsFromNote(linkedFile, tags);
                    if (updated) updatedCount++;
                }
            }
            
            console.log(`${updatedCount}개 노트의 태그가 업데이트되었습니다.`);
            return true;
        } catch (error) {
            console.error("태그 삭제 중 오류:", error);
            throw error;
        }
    }

    /**
     * 연결된 노트의 태그를 현재 노트의 태그로 변경합니다.
     * @param sourceFile 소스 파일
     * @param tags 적용할 태그 배열
     * @returns 성공 여부
     */
    async replaceTagsInLinkedNotes(sourceFile: TFile, tags: string[]): Promise<boolean> {
        try {
            if (!sourceFile || !tags || tags.length === 0) {
                return false;
            }

            const links = this.app.metadataCache.resolvedLinks[sourceFile.path] || {};
            let updatedCount = 0;
            
            for (const linkedPath of Object.keys(links)) {
                const linkedFile = this.app.vault.getAbstractFileByPath(linkedPath);
                if (linkedFile instanceof TFile && linkedFile.path !== sourceFile.path) {
                    const updated = await this.replaceTagsInNote(linkedFile, tags);
                    if (updated) updatedCount++;
                }
            }
            
            console.log(`${updatedCount}개 노트의 태그가 변경되었습니다.`);
            return true;
        } catch (error) {
            console.error("태그 변경 중 오류:", error);
            throw error;
        }
    }

    /**
     * 노트에 태그를 추가합니다.
     * @param file 대상 파일
     * @param newTags 추가할 태그 배열
     * @returns 업데이트 여부
     */
    private async addTagsToNote(file: TFile, newTags: string[]): Promise<boolean> {
        const content = await this.app.vault.read(file);
        const frontmatterManager = new FrontmatterManager();
        const frontmatter = frontmatterManager.parseFrontmatter(content);
        
        if (!frontmatter) return false;
        
        // 기존 태그 배열 확인
        if (!frontmatter.tags || !Array.isArray(frontmatter.tags)) {
            frontmatter.tags = [];
        }
        
        // 추가해야 할 태그만 필터링
        const tagsToAdd = newTags.filter(tag => !frontmatter.tags.includes(tag));
        
        // 추가할 태그가 없으면 업데이트하지 않음
        if (tagsToAdd.length === 0) {
            return false;
        }
        
        // 태그 추가
        frontmatter.tags = [...frontmatter.tags, ...tagsToAdd];
        
        // frontmatter 업데이트
        const updatedContent = frontmatterManager.updateFrontmatter(content, {
            tags: frontmatter.tags
        });
        
        await this.app.vault.modify(file, updatedContent);
        return true;
    }

    /**
     * 노트에서 태그를 삭제합니다.
     * @param file 대상 파일
     * @param tagsToRemove 삭제할 태그 배열
     * @returns 업데이트 여부
     */
    private async removeTagsFromNote(file: TFile, tagsToRemove: string[]): Promise<boolean> {
        const content = await this.app.vault.read(file);
        const frontmatterManager = new FrontmatterManager();
        const frontmatter = frontmatterManager.parseFrontmatter(content);
        
        if (!frontmatter || !frontmatter.tags || !Array.isArray(frontmatter.tags)) {
            return false;
        }
        
        // 삭제할 태그가 있는지 확인
        const originalLength = frontmatter.tags.length;
        frontmatter.tags = frontmatter.tags.filter(tag => !tagsToRemove.includes(tag));
        
        // 변경된 태그가 없으면 업데이트하지 않음
        if (frontmatter.tags.length === originalLength) {
            return false;
        }
        
        // frontmatter 업데이트
        const updatedContent = frontmatterManager.updateFrontmatter(content, {
            tags: frontmatter.tags
        });
        
        await this.app.vault.modify(file, updatedContent);
        return true;
    }

    /**
     * 노트의 태그를 새로운 태그로 완전히 교체합니다.
     * @param file 대상 파일
     * @param newTags 새 태그 배열
     * @returns 업데이트 여부
     */
    private async replaceTagsInNote(file: TFile, newTags: string[]): Promise<boolean> {
        const content = await this.app.vault.read(file);
        const frontmatterManager = new FrontmatterManager();
        const frontmatter = frontmatterManager.parseFrontmatter(content);
        
        if (!frontmatter) return false;
        
        // 기존 기본 태그는 유지하고, 새로운 태그에서 기본 태그를 제외한 태그만 추가
        const nonDefaultNewTags = FrontmatterManager.getNonDefaultTags(newTags);
        
        // 현재 파일의 기존 태그에서 기본 태그만 유지
        const existingDefaultTags = Array.isArray(frontmatter.tags) ? 
            frontmatter.tags.filter((tag: string) => FrontmatterManager.DEFAULT_TAGS.includes(tag)) : 
            [];
        
        // 기존 기본 태그와 새로운 비기본 태그 합치기
        const updatedTags = [...existingDefaultTags, ...nonDefaultNewTags];
        
        // 태그에 변경이 있는지 확인
        const oldTagsStr = JSON.stringify(frontmatter.tags || []);
        const newTagsStr = JSON.stringify(updatedTags);
        
        if (oldTagsStr === newTagsStr) {
            return false;
        }
        
        // frontmatter 업데이트
        const updatedContent = frontmatterManager.updateFrontmatter(content, {
            tags: updatedTags
        });
        
        await this.app.vault.modify(file, updatedContent);
        return true;
    }

    private parseFrontmatter(frontmatterContent: string): { [key: string]: any } {
        const frontmatter: { [key: string]: any } = {};
        const lines = frontmatterContent.split('\n');

        let currentKey = '';
        for (const line of lines) {
            if (line.includes(':')) {
                const [key, value] = line.split(':').map(s => s.trim());
                if (key === 'tags') {
                    frontmatter[key] = [];
                    currentKey = key;
                } else {
                    frontmatter[key] = value;
                }
            } else if (line.trim().startsWith('-') && currentKey === 'tags') {
                frontmatter.tags.push(line.trim().substring(1).trim());
            }
        }

        return frontmatter;
    }

    // 레거시 메서드 - 이전 호환성을 위해 유지
    private async updateLinkedNotesTags(sourceFile: TFile, tags: string[]): Promise<void> {
        await this.replaceTagsInLinkedNotes(sourceFile, tags);
    }

    // 레거시 메서드 - 이전 호환성을 위해 유지
    private async updateNoteTags(file: TFile, newTags: string[]): Promise<void> {
        await this.replaceTagsInNote(file, newTags);
    }

    // 레거시 메서드 - 이전 호환성을 위해 유지
    private generateFrontmatter(frontmatter: { [key: string]: any }): string {
        let output = '---\n';
        
        for (const [key, value] of Object.entries(frontmatter)) {
            if (Array.isArray(value)) {
                output += `${key}:\n`;
                value.forEach(item => {
                    output += `  - ${item}\n`;
                });
            } else {
                output += `${key}: ${value}\n`;
            }
        }

        output += '---';
        return output;
    }
}
