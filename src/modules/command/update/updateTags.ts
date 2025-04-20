import { App, Notice, TFile } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { showConfirmationDialog } from '../../../components/commonUI/confirmationModal';
import { FrontmatterManager } from '../../../core/utils/frontmatterManager';
import { TagSyncModal } from '../../../components/tagUI/tagSyncModal';

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
     * @param recursive 재귀적으로 적용할지 여부 (기본값: true)
     * @returns 성공 여부
     */
    async addTagsToLinkedNotes(sourceFile: TFile, tags: string[], recursive: boolean = true): Promise<boolean> {
        try {
            if (!sourceFile || !tags || tags.length === 0) {
                return false;
            }

            const links = this.app.metadataCache.resolvedLinks[sourceFile.path] || {};
            let updatedCount = 0;
            
            // 처리된 노트를 추적하기 위한 Set (순환 참조 방지)
            const processedFiles = new Set<string>([sourceFile.path]);
            
            // 첫 번째 레벨 노트 처리
            for (const linkedPath of Object.keys(links)) {
                const linkedFile = this.app.vault.getAbstractFileByPath(linkedPath);
                if (linkedFile instanceof TFile) {
                    // 노트에 태그 추가 및 업데이트 카운트 증가
                    const updated = await this.addTagsToNote(linkedFile, tags);
                    if (updated) updatedCount++;
                    
                    // 처리된 노트로 표시
                    processedFiles.add(linkedFile.path);
                    
                    // 재귀적으로 처리하는 경우, 연결된 노트에 대해서도 처리
                    if (recursive) {
                        updatedCount += await this.processLinkedNotesRecursively(
                            linkedFile, 
                            tags, 
                            processedFiles, 
                            this.addTagsToNote.bind(this)
                        );
                    }
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
     * @param recursive 재귀적으로 적용할지 여부 (기본값: true)
     * @returns 성공 여부
     */
    async removeTagsFromLinkedNotes(sourceFile: TFile, tags: string[], recursive: boolean = true): Promise<boolean> {
        try {
            if (!sourceFile || !tags || tags.length === 0) {
                return false;
            }

            const links = this.app.metadataCache.resolvedLinks[sourceFile.path] || {};
            let updatedCount = 0;
            
            // 처리된 노트를 추적하기 위한 Set (순환 참조 방지)
            const processedFiles = new Set<string>([sourceFile.path]);
            
            // 첫 번째 레벨 노트 처리
            for (const linkedPath of Object.keys(links)) {
                const linkedFile = this.app.vault.getAbstractFileByPath(linkedPath);
                if (linkedFile instanceof TFile) {
                    // 노트에서 태그 삭제 및 업데이트 카운트 증가
                    const updated = await this.removeTagsFromNote(linkedFile, tags);
                    if (updated) updatedCount++;
                    
                    // 처리된 노트로 표시
                    processedFiles.add(linkedFile.path);
                    
                    // 재귀적으로 처리하는 경우, 연결된 노트에 대해서도 처리
                    if (recursive) {
                        updatedCount += await this.processLinkedNotesRecursively(
                            linkedFile, 
                            tags, 
                            processedFiles, 
                            this.removeTagsFromNote.bind(this)
                        );
                    }
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
     * @param recursive 재귀적으로 적용할지 여부 (기본값: true)
     * @returns 성공 여부
     */
    async replaceTagsInLinkedNotes(sourceFile: TFile, tags: string[], recursive: boolean = true): Promise<boolean> {
        try {
            if (!sourceFile || !tags || tags.length === 0) {
                return false;
            }

            const links = this.app.metadataCache.resolvedLinks[sourceFile.path] || {};
            let updatedCount = 0;
            
            // 처리된 노트를 추적하기 위한 Set (순환 참조 방지)
            const processedFiles = new Set<string>([sourceFile.path]);
            
            // 첫 번째 레벨 노트 처리
            for (const linkedPath of Object.keys(links)) {
                const linkedFile = this.app.vault.getAbstractFileByPath(linkedPath);
                if (linkedFile instanceof TFile && linkedFile.path !== sourceFile.path) {
                    // 노트의 태그 교체 및 업데이트 카운트 증가
                    const updated = await this.replaceTagsInNote(linkedFile, tags);
                    if (updated) updatedCount++;
                    
                    // 처리된 노트로 표시
                    processedFiles.add(linkedFile.path);
                    
                    // 재귀적으로 처리하는 경우, 연결된 노트에 대해서도 처리
                    if (recursive) {
                        updatedCount += await this.processLinkedNotesRecursively(
                            linkedFile, 
                            tags, 
                            processedFiles, 
                            this.replaceTagsInNote.bind(this)
                        );
                    }
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
     * 연결된 노트를 재귀적으로 처리하는 메서드
     * @param sourceFile 소스 파일
     * @param tags 작업할 태그 배열
     * @param processedFiles 이미 처리된 파일 Set (순환 참조 방지)
     * @param tagOperation 각 파일에 수행할 태그 작업 함수 (addTagsToNote, removeTagsFromNote, replaceTagsInNote)
     * @returns 업데이트된 노트 수
     */
    private async processLinkedNotesRecursively(
        sourceFile: TFile, 
        tags: string[], 
        processedFiles: Set<string>,
        tagOperation: (file: TFile, tags: string[]) => Promise<boolean>
    ): Promise<number> {
        let updatedCount = 0;
        
        // 현재 노트에 연결된 다른 노트들을 가져옴
        const links = this.app.metadataCache.resolvedLinks[sourceFile.path] || {};
        
        for (const linkedPath of Object.keys(links)) {
            // 이미 처리된 노트는 건너뜀 (순환 참조 방지)
            if (processedFiles.has(linkedPath)) continue;
            
            const linkedFile = this.app.vault.getAbstractFileByPath(linkedPath);
            if (linkedFile instanceof TFile) {
                // 노트에 태그 작업 수행
                const updated = await tagOperation(linkedFile, tags);
                if (updated) updatedCount++;
                
                // 처리된 것으로 표시
                processedFiles.add(linkedFile.path);
                
                // 이 노트와 연결된 노트들에도 재귀적으로 같은 작업 수행
                updatedCount += await this.processLinkedNotesRecursively(
                    linkedFile,
                    tags,
                    processedFiles,
                    tagOperation
                );
            }
        }
        
        return updatedCount;
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
