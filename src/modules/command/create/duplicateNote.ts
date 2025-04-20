import { App, Notice, TFile, normalizePath } from 'obsidian';
import { moment } from 'obsidian';
import type AILSSPlugin from 'main';
import { PathSettings } from '../../../core/settings/pathSettings';
import { FrontmatterManager } from '../../../core/utils/frontmatterManager';

export class DuplicateNote {
    constructor(
        private app: App,
        private plugin: AILSSPlugin
    ) {}

    async duplicateCurrentNote(): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('열린 노트가 없습니다.');
            return;
        }

        try {
            // 노트 개수 제한 확인
            if (!(await PathSettings.checkNoteLimit(this.app, this.plugin))) {
                new Notice(`노트 개수가 최대 제한(${PathSettings.MAX_NOTES}개)에 도달했습니다.`);
                return;
            }

            // 현재 노트의 내용과 프론트매터 읽기
            const content = await this.app.vault.read(activeFile);
            const frontmatterManager = new FrontmatterManager();
            const currentFrontmatter = frontmatterManager.parseFrontmatter(content) || {};
            
            // 현재 시간 기준으로 새 타임스탬프 생성
            const now = moment();
            const timestamp = now.format('YYYYMMDDHHmmss');
            const koreanTime = now.clone().add(9, 'hours').toISOString().split('.')[0];
            
            // 기존 태그에 'copy' 추가
            let tags = currentFrontmatter.tags || [];
            if (Array.isArray(tags)) {
                if (!tags.includes('copy')) {
                    tags.push('copy');
                }
            } else {
                tags = ['copy'];
            }
            
            // 현재 제목 가져오기 및 'copy' 접미사 추가
            let title = currentFrontmatter.title || '';
            if (typeof title === 'string') {
                // 이미 따옴표로 감싸져 있을 수 있으므로 제거 후 'copy' 추가
                title = frontmatterManager.removeQuotes(title) + ' copy';
            }
            
            // 새 프론트매터 속성 구성
            const updatedFrontmatter = {
                ...currentFrontmatter,
                id: timestamp,
                date: koreanTime,
                updated: koreanTime,
                potentiation: FrontmatterManager.INITIAL_POTENTIATION,
                tags: tags,
                title: title // 'copy'가 추가된 제목 설정
            };
            
            // 본문 내용 추출 (프론트매터 제외)
            let bodyContent = this.extractBodyContent(content);
            
            // 첨부 파일 찾기 및 복사
            const attachmentPattern = /!\[\[(.*?)\]\]/g;
            const matches = Array.from(bodyContent.matchAll(attachmentPattern));
            
            if (matches.length > 0) {
                // 첨부 파일을 찾은 경우
                let updatedBodyContent = bodyContent;
                const attachmentMap = new Map<string, string>(); // 원본 → 새 경로 매핑
                
                // 파일 복사 전에 새 노트 생성
                const { file: newFile } = await PathSettings.createNote({
                    app: this.app,
                    frontmatterConfig: updatedFrontmatter,
                    content: bodyContent,
                    timestamp: now,
                    isInherited: false
                });
                
                // 새 노트의 폴더 경로 (YYYY/MM/DD/)
                const newNoteFolderPath = newFile.parent?.path || "";
                
                // 각 첨부 파일 처리
                let index = 1;
                for (const match of matches) {
                    try {
                        const originalEmbed = match[0];
                        const originalPath = match[1].trim();
                        
                        // 첨부파일 찾기
                        const attachmentFile = await this.findAttachmentFile(originalPath, activeFile);
                        
                        if (attachmentFile) {
                            // 새 경로 생성 (새 타임스탬프-인덱스.확장자)
                            const newFileName = `${timestamp}-${index}.${attachmentFile.extension}`;
                            const newPath = normalizePath(`${newNoteFolderPath}/${newFileName}`);
                            
                            // 파일 복사
                            const fileContent = await this.app.vault.readBinary(attachmentFile);
                            await this.app.vault.createBinary(newPath, fileContent);
                            
                            // 링크 업데이트
                            const newEmbed = `![[${newFileName}]]`;
                            attachmentMap.set(originalEmbed, newEmbed);
                            
                            index++;
                        }
                    } catch (e) {
                        console.error("첨부 파일 처리 중 오류:", e);
                        continue;
                    }
                }
                
                // 노트 내용 업데이트
                for (const [original, updated] of attachmentMap.entries()) {
                    updatedBodyContent = updatedBodyContent.replace(original, updated);
                }
                
                // 노트 내용 업데이트
                if (updatedBodyContent !== bodyContent) {
                    await this.app.vault.modify(newFile, frontmatterManager.generateFrontmatter(updatedFrontmatter, false) + '\n' + updatedBodyContent);
                }
                
                // 새 탭에서 복제된 파일 열기
                const leaf = this.app.workspace.getLeaf('tab');
                await leaf.openFile(newFile);
                
                new Notice(`노트와 ${index - 1}개의 첨부파일이 복제되었습니다.`);
            } else {
                // 첨부 파일이 없는 경우 - 기존 방식으로 노트만 복제
                const { file } = await PathSettings.createNote({
                    app: this.app,
                    frontmatterConfig: updatedFrontmatter,
                    content: bodyContent,
                    timestamp: now,
                    isInherited: false
                });
                
                // 새 탭에서 복제된 파일 열기
                const leaf = this.app.workspace.getLeaf('tab');
                await leaf.openFile(file);
                
                new Notice('노트가 복제되었습니다.');
            }
        } catch (error) {
            console.error('노트 복제 중 오류 발생:', error);
            new Notice('노트 복제 중 오류가 발생했습니다.');
        }
    }
    
    // 프론트매터를 제외한 본문만 추출
    private extractBodyContent(content: string): string {
        const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
        return content.replace(frontmatterRegex, '').trim();
    }
    
    // 첨부파일 찾기 메서드
    private async findAttachmentFile(originalPath: string, currentFile: TFile): Promise<TFile | null> {
        // 1. 첨부파일 경로 패턴 분석 시도 (타임스탬프-인덱스.확장자)
        const fileNamePattern = /^(\d{14})-(\d+)\.(.+)$/;
        const fileNameMatch = originalPath.match(fileNamePattern);
        let attachmentFile: TFile | null = null;
        
        // 1-1. 패턴이 맞으면 해당 경로에서 찾기 시도
        if (fileNameMatch) {
            const timestamp = fileNameMatch[1];
            const dateStr = timestamp.substring(0, 8);
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            const datePath = `${year}/${month}/${day}`;
            
            // 첨부파일 전체 경로 생성
            const fullPath = normalizePath(`${datePath}/${originalPath}`);
            
            // 첨부파일 찾기
            attachmentFile = this.app.vault.getAbstractFileByPath(fullPath) as TFile;
        }
        
        // 1-2. 못찾았거나 패턴이 안맞으면 상대 경로로 시도
        if (!(attachmentFile instanceof TFile)) {
            const currentParentPath = currentFile.parent?.path || "";
            // 현재 노트 폴더 기준 상대 경로로 시도
            const relativePath = normalizePath(`${currentParentPath}/${originalPath}`);
            attachmentFile = this.app.vault.getAbstractFileByPath(relativePath) as TFile;
        }
        
        // 1-3. 그래도 못찾으면 파일명으로 전체 검색
        if (!(attachmentFile instanceof TFile)) {
            // 볼트 내 모든 파일 중에서 이름이 일치하는 파일 검색
            const fileName = originalPath.split('/').pop() || originalPath;
            const files = this.app.vault.getAllLoadedFiles();
            const matchingFiles = files.filter(file => 
                file instanceof TFile && file.name === fileName
            ) as TFile[];
            
            if (matchingFiles.length > 0) {
                attachmentFile = matchingFiles[0];
            }
        }
        
        return attachmentFile;
    }
}