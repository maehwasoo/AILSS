import { App, Notice, TFile, Plugin, normalizePath } from 'obsidian';
import AILSSPlugin from 'main';

export class UpdateAttachments {
    private app: App;
    private plugin: AILSSPlugin;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async updateAttachments(): Promise<void> {
        try {
            const currentFile = this.app.workspace.getActiveFile();
            if (!currentFile) {
                new Notice("활성화된 파일이 없습니다.");
                return;
            }

            const content = await this.app.vault.read(currentFile);
            const attachmentPattern = /!\[\[(.*?)\]\]/g;
            const matches = Array.from(content.matchAll(attachmentPattern));
            console.log("찾은 첨부파일 매치:", matches.length);
            
            if (matches.length === 0) {
                new Notice("첨부 파일을 찾을 수 없습니다.");
                return;
            }

            let updatedContent = content;
            let changedCount = 0;

            for (const match of matches) {
                try {
                    const originalEmbed = match[0];
                    const originalPath = match[1].trim();
                    console.log("처리중인 경로:", originalPath);
                    
                    const currentParentPath = currentFile.parent?.path || "";
                    console.log("현재 노트 경로:", currentParentPath);

                    const fullPath = normalizePath(`${currentParentPath}/${originalPath}`);
                    const attachmentFile = this.app.vault.getAbstractFileByPath(fullPath);
                    console.log("첨부파일 찾음:", attachmentFile?.path);
                    
                    // 파일명 패턴을 확인 (노트명-숫자.확장자)
                    const fileNamePattern = /^(.+)-(\d+)\.(.+)$/;
                    const fileNameMatch = originalPath.match(fileNamePattern);
                    
                    // 현재 노트에 이미 맞게 이름이 지정된 경우만 스킵
                    if (fileNameMatch && fileNameMatch[1] === currentFile.basename) {
                        console.log("이미 현재 노트에 맞게 이름이 변경된 파일:", originalPath);
                        continue;
                    }

                    if (!(attachmentFile instanceof TFile)) {
                        console.log("첨부파일이 TFile이 아님");
                        continue;
                    }
                    
                    let counter = 1;
                    let newFileName;
                    let newPath;
                    
                    // 중복되지 않는 파일 이름을 찾을 때까지 반복
                    do {
                        newFileName = `${currentFile.basename}-${counter}.${attachmentFile.extension}`;
                        newPath = normalizePath(`${currentParentPath}/${newFileName}`);
                        counter++;
                    } while (this.app.vault.getAbstractFileByPath(newPath));
                    
                    console.log("새 경로:", newPath);
                    
                    // 파일 이름 변경
                    await this.app.fileManager.renameFile(attachmentFile, newPath);
                    
                    // 링크 업데이트
                    const newEmbed = `![[${newFileName}]]`;
                    updatedContent = updatedContent.replace(originalEmbed, newEmbed);
                    changedCount++;

                } catch (e) {
                    console.error("파일 처리 중 오류:", e);
                    continue;
                }
            }

            if (changedCount > 0) {
                await this.app.vault.modify(currentFile, updatedContent);
                new Notice(`${changedCount}개의 첨부 파일 이름이 변경되었습니다.`);
            } else {
                new Notice("변경된 파일이 없습니다.");
            }

        } catch (error) {
            console.error("첨부 파일 업데이트 중 오류:", error);
            new Notice("첨부 파일 업데이트 중 오류가 발생했습니다.");
        }
    }
}
