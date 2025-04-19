import { App, Notice, TFile } from 'obsidian';
import type AILSSPlugin from '../../../../main';
import { showConfirmationDialog } from '../../../components/commonUI/confirmationModal';
import { CleanEmptyFolders } from '../../../core/utils/cleanEmptyFolders';
import { RemoveNoteLinks } from './removeNoteLinks';
import { FrontmatterManager } from '../../../core/utils/frontmatterManager';

export class DeleteCurrentNote {
    private app: App;
    private plugin: AILSSPlugin;
    private cleanEmptyFolders: CleanEmptyFolders;
    private removeNoteLinks: RemoveNoteLinks;
    private frontmatterManager: FrontmatterManager;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.cleanEmptyFolders = new CleanEmptyFolders(this.app, this.plugin);
        this.removeNoteLinks = new RemoveNoteLinks(this.app);
        this.frontmatterManager = new FrontmatterManager();
    }

    async deleteNote(): Promise<void> {
        try {
            const currentFile = this.app.workspace.getActiveFile();
            if (!currentFile) {
                new Notice("활성화된 파일이 없습니다.");
                return;
            }

            // 프론트매터에서 강화 단계 확인
            const content = await this.app.vault.read(currentFile);
            const frontmatter = this.frontmatterManager.parseFrontmatter(content);
            const potentiation = frontmatter?.potentiation ?? 0;

            // 강화 단계가 3~8 사이인지 확인
            // if (potentiation < 3 || potentiation > 8) {
            //     new Notice(`강화 단계가 3~8 사이인 노트만 삭제할 수 있습니다. (현재: ${potentiation})`);
            //     return;
            // }

            // 첨부파일 찾기
            const attachments = await this.findAllAttachments(content);

            // 블록 링크 찾기
            const blockLinks = await this.findBlockReferences(currentFile);

            // 삭제 확인 메시지 수정
            const noteName = `${currentFile.name}`;
            let deleteMessage = `관련된 모든 링크를 해제하고 삭제하시겠습니까?`;
            
            if (attachments.length > 0) {
                deleteMessage = `${attachments.length}개의 첨부파일을 포함하여 삭제하시겠습니까?`;
            }
            
            if (blockLinks.length > 0) {
                deleteMessage += `\n${blockLinks.length}개의 블록 링크도 해제됩니다.`;
            }
            
            const confirmMessage = `${noteName}\n\n${deleteMessage}`;

            const shouldDelete = await showConfirmationDialog(this.app, {
                title: "노트 삭제",
                message: confirmMessage,
                confirmText: "삭제",
                cancelText: "취소",
                type: "danger"  // 위험 작업 타입으로 지정
            });

            if (!shouldDelete) {
                new Notice("작업이 취소되었습니다.");
                return;
            }
            
            // 블록 링크 제거
            if (blockLinks.length > 0) {
                await this.removeBlockIdsFromLinkedNotes(blockLinks);
            }

            // 백링크 처리
            await this.removeNoteLinks.removeLinksToFile(currentFile);

            // 첨부파일 삭제
            for (const attachment of attachments) {
                await this.app.vault.trash(attachment, true);
            }

            // 현재 노트 삭제
            await this.app.vault.trash(currentFile, true);
            
            // 빈 폴더 정리
            await this.cleanEmptyFolders.cleanEmptyFoldersInVault();

            let message = "노트가 삭제되었고 관련 링크가 모두 해제되었습니다.";
            
            if (attachments.length > 0) {
                message = `노트와 ${attachments.length}개의 첨부파일이 삭제되었고 관련 링크가 모두 해제되었습니다.`;
            }
            
            if (blockLinks.length > 0) {
                message += ` ${blockLinks.length}개의 블록 ID가 제거되었습니다.`;
            }

            new Notice(message);
        } catch (error) {
            console.error("노트 삭제 중 오류 발생:", error);
            new Notice(`오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async findAllAttachments(content: string): Promise<TFile[]> {
        // 더 정확한 첨부파일 정규식 패턴 (위키링크와 마크다운 링크 모두 지원)
        const wikiLinkRegex = /!\[\[([^\]|#]+)(?:\|[^\]]+)?(?:#[^\]]+)?\]\]/g;
        const markdownLinkRegex = /!\[.*?\]\(([^)]+)\)/g;
        const attachments: TFile[] = [];
        let match;

        console.log("첨부파일 검색 시작");

        // 위키링크 형식의 첨부파일 찾기
        while ((match = wikiLinkRegex.exec(content)) !== null) {
            const attachmentPath = match[1].trim();
            console.log("위키링크 형식 첨부파일 발견:", attachmentPath);
            
            // 필요시 경로 정규화
            const normalizedPath = this.normalizePath(attachmentPath);
            console.log("정규화된 경로:", normalizedPath);
            
            const attachmentFile = this.app.vault.getAbstractFileByPath(normalizedPath);
            
            if (attachmentFile instanceof TFile) {
                console.log("첨부파일 찾음:", attachmentFile.path);
                attachments.push(attachmentFile);
            } else {
                console.log("파일을 찾을 수 없음:", normalizedPath);
            }
        }
        
        // 마크다운 링크 형식의 첨부파일 찾기
        while ((match = markdownLinkRegex.exec(content)) !== null) {
            const attachmentPath = match[1].trim();
            console.log("마크다운 링크 형식 첨부파일 발견:", attachmentPath);
            
            // 필요시 경로 정규화
            const normalizedPath = this.normalizePath(attachmentPath);
            console.log("정규화된 경로:", normalizedPath);
            
            const attachmentFile = this.app.vault.getAbstractFileByPath(normalizedPath);
            
            if (attachmentFile instanceof TFile) {
                console.log("첨부파일 찾음:", attachmentFile.path);
                attachments.push(attachmentFile);
            } else {
                console.log("파일을 찾을 수 없음:", normalizedPath);
            }
        }
        
        console.log(`총 ${attachments.length}개의 첨부파일을 찾음`);
        return attachments;
    }

    // 경로 정규화를 위한 유틸리티 메서드 추가
    private normalizePath(path: string): string {
        // URL 인코딩 된 문자 디코딩
        path = decodeURIComponent(path);
        
        // 파일:// 프로토콜 제거
        if (path.startsWith('file://')) {
            path = path.substring(7);
        }
        
        // 상대 경로 처리 (필요한 경우)
        if (!path.startsWith('/') && !path.includes(':')) {
            const currentFile = this.app.workspace.getActiveFile();
            if (currentFile) {
                const currentFolder = currentFile.parent?.path || '';
                if (currentFolder) {
                    path = `${currentFolder}/${path}`;
                }
            }
        }
        
        return path;
    }

    private async findBlockReferences(currentFile: TFile): Promise<{noteFile: TFile, blockId: string}[]> {
        const blockReferences: {noteFile: TFile, blockId: string}[] = [];
        
        // 노트 내용 읽기
        const content = await this.app.vault.read(currentFile);
        
        // 블록 ID 찾기
        const blockIdRegex = / \^([a-zA-Z0-9]+)/g;
        let blockMatch;
        
        while ((blockMatch = blockIdRegex.exec(content)) !== null) {
            const blockId = blockMatch[1];
            
            // 블록 ID를 참조하는 모든 노트 찾기
            const files = this.app.vault.getMarkdownFiles();
            
            for (const file of files) {
                if (file.path !== currentFile.path) {
                    const fileContent = await this.app.vault.read(file);
                    
                    // 블록 참조 형식: ![[노트이름#^blockId]] 또는 [[노트이름#^blockId]]
                    const blockRefRegex = new RegExp(`\\[\\[${currentFile.basename}#\\^${blockId}`, 'g');
                    const embedRefRegex = new RegExp(`!\\[\\[${currentFile.basename}#\\^${blockId}`, 'g');
                    
                    if (blockRefRegex.test(fileContent) || embedRefRegex.test(fileContent)) {
                        blockReferences.push({
                            noteFile: file,
                            blockId: blockId
                        });
                    }
                }
            }
        }
        
        return blockReferences;
    }

    private async removeBlockIdsFromLinkedNotes(blockLinks: {noteFile: TFile, blockId: string}[]): Promise<void> {
        for (const {noteFile, blockId} of blockLinks) {
            try {
                // 파일 내용 읽기
                const content = await this.app.vault.read(noteFile);
                
                // 블록 참조 찾아서 텍스트로 변환
                const blockRefRegex = new RegExp(`\\[\\[.*?#\\^${blockId}(?:\\|([^\\]]+))?\\]\\]`, 'g');
                const embedRefRegex = new RegExp(`!\\[\\[.*?#\\^${blockId}(?:\\|([^\\]]+))?\\]\\]`, 'g');
                
                let modifiedContent = content;
                
                // 일반 링크 처리
                modifiedContent = modifiedContent.replace(blockRefRegex, (match, alias) => {
                    return alias || '';
                });
                
                // 임베드 링크 처리
                modifiedContent = modifiedContent.replace(embedRefRegex, (match, alias) => {
                    return alias || '';
                });
                
                // 변경된 내용이 있을 경우에만 저장
                if (content !== modifiedContent) {
                    await this.app.vault.modify(noteFile, modifiedContent);
                }
            } catch (error) {
                console.error(`블록 ID 제거 중 오류 발생: ${error}`);
            }
        }
    }
}
