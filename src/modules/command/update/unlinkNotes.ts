import { App, Notice, TFile } from 'obsidian';
import type AILSSPlugin from '../../../../main';
import { showConfirmationDialog } from '../../../components/commonUI/confirmationModal';

export class UnlinkNotes {
    private app: App;
    private plugin: AILSSPlugin;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async unlinkSelectedNotes() {
        try {
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                new Notice('활성화된 노트가 없습니다.');
                return;
            }

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

            // 노트 링크와 블록 링크 찾기
            const links = this.findLinks(selectedText);
            
            if (links.length === 0) {
                new Notice('선택된 텍스트에서 링크를 찾을 수 없습니다.');
                return;
            }

            // 링크 해제 전 확인
            const confirmMessage = `${links.length}개의 링크를 해제하시겠습니까?\n\n${links.map(link => `- ${link.originalText}`).join('\n')}`;
            
            const confirmed = await showConfirmationDialog(this.app, {
                title: "링크 해제 확인",
                message: confirmMessage,
                confirmText: "해제",
                cancelText: "취소"
            });

            if (!confirmed) {
                new Notice("작업이 취소되었습니다.");
                return;
            }

            // 링크 해제 처리
            let modifiedText = selectedText;
            for (const link of links) {
                modifiedText = modifiedText.replace(link.originalText, link.displayText);
                
                // 블록 링크인 경우 연결된 노트에서 블록 ID 제거
                if (link.isBlockLink && link.blockId && link.noteId) {
                    await this.removeBlockIdFromLinkedNote(link.noteId, link.blockId);
                }
            }

            editor.replaceSelection(modifiedText);
            new Notice(`${links.length}개의 링크가 해제되었습니다.`);

        } catch (error) {
            new Notice('작업 실패: ' + error.message);
        }
    }

    private findLinks(text: string): Array<{
        originalText: string, 
        displayText: string, 
        isBlockLink: boolean, 
        noteId?: string, 
        blockId?: string
    }> {
        const links: Array<{
            originalText: string, 
            displayText: string, 
            isBlockLink: boolean, 
            noteId?: string, 
            blockId?: string
        }> = [];
        
        // 일반 노트 링크 찾기 ([[...]] 형식)
        const noteRegex = /(?<!!)\[\[(.*?)\]\]/g;
        let noteMatch;
        
        while ((noteMatch = noteRegex.exec(text)) !== null) {
            const originalText = noteMatch[0]; // [[...]] 전체 텍스트
            const linkContent = noteMatch[1]; // ... 부분 (노트 ID 또는 노트 ID|별칭)
            
            let displayText;
            if (linkContent.includes('|')) {
                // 별칭이 있는 경우: [[노트 ID|별칭]] -> 별칭
                displayText = linkContent.split('|')[1];
            } else {
                // 별칭이 없는 경우: [[노트 ID]] -> 노트 ID
                displayText = linkContent;
            }
            
            links.push({
                originalText,
                displayText,
                isBlockLink: false
            });
        }
        
        // 블록 링크 찾기 (![[노트ID#^블록ID|별칭]] 형식)
        const blockRegex = /!\[\[(.*?)#\^(.*?)(?:\|(.*?))?\]\]/g;
        let blockMatch;
        
        while ((blockMatch = blockRegex.exec(text)) !== null) {
            const originalText = blockMatch[0]; // ![[노트ID#^블록ID|별칭]] 전체 텍스트
            const noteId = blockMatch[1]; // 노트 ID
            const blockId = blockMatch[2]; // 블록 ID
            
            // 별칭이 있는 경우: ![[노트ID#^블록ID|별칭]] -> 별칭
            // 별칭이 없는 경우: ![[노트ID#^블록ID]] -> 노트ID
            const displayText = blockMatch[3] || noteId;
            
            links.push({
                originalText,
                displayText,
                isBlockLink: true,
                noteId,
                blockId
            });
        }

        return links;
    }
    
    private async removeBlockIdFromLinkedNote(noteId: string, blockId: string): Promise<void> {
        try {
            // 노트 ID로 파일 찾기
            const files = this.app.vault.getMarkdownFiles();
            const targetFile = files.find(file => file.basename === noteId);
            
            if (!targetFile) {
                new Notice(`연결된 노트 ${noteId}를 찾을 수 없습니다.`);
                return;
            }
            
            // 파일 내용 읽기
            const content = await this.app.vault.read(targetFile);
            
            // 블록 ID 패턴 찾기 (텍스트 ^블록ID)
            const blockIdPattern = new RegExp(`(.*?) \\^${blockId}`, 'gm');
            const newContent = content.replace(blockIdPattern, '$1');
            
            if (content !== newContent) {
                // 변경된 내용으로 파일 수정
                await this.app.vault.modify(targetFile, newContent);
                new Notice(`노트 ${noteId}에서 블록 ID를 제거했습니다.`);
            }
        } catch (error) {
            new Notice(`블록 ID 제거 실패: ${error.message}`);
        }
    }
} 