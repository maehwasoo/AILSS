import { App, Notice, TFile, Plugin, normalizePath } from 'obsidian';
import AILSSPlugin from 'main';
import { PathSettings } from '../../../core/settings/pathSettings';

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

            // 현재 노트의 타임스탬프를 추출 (파일 이름 기반)
            const currentNoteTimestampMatch = currentFile.basename.match(/^(\d{14})$/);
            if (!currentNoteTimestampMatch) {
                new Notice("현재 노트 이름이 타임스탬프 형식이 아닙니다: " + currentFile.basename);
                return;
            }
            const currentNoteTimestamp = currentNoteTimestampMatch[1];

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

                    // 첨부파일 찾기
                    let attachmentFile: TFile | null = null;
                    
                    // 1. 첨부파일 경로 패턴 분석 시도 (타임스탬프-인덱스.확장자)
                    const fileNamePattern = /^(\d{14})-(\d+)\.(.+)$/;
                    const fileNameMatch = originalPath.match(fileNamePattern);
                    
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
                        console.log("첨부파일 추정 경로 (타임스탬프 기반):", fullPath);
                        
                        // 첨부파일 찾기
                        attachmentFile = this.app.vault.getAbstractFileByPath(fullPath) as TFile;
                        
                        // 이미 현재 노트에 맞게 이름이 지정된 경우 스킵
                        if (attachmentFile instanceof TFile && timestamp === currentNoteTimestamp) {
                            console.log("이미 현재 노트에 맞게 이름이 변경된 파일:", originalPath);
                            continue;
                        }
                    }
                    
                    // 1-2. 못찾았거나 패턴이 안맞으면 상대 경로로 시도
                    if (!(attachmentFile instanceof TFile)) {
                        // 현재 노트 폴더 기준 상대 경로로 시도
                        const relativePath = normalizePath(`${currentParentPath}/${originalPath}`);
                        attachmentFile = this.app.vault.getAbstractFileByPath(relativePath) as TFile;
                        console.log("상대 경로로 시도:", relativePath, "결과:", attachmentFile?.path);
                    }
                    
                    // 1-3. 그래도 못찾으면 파일명으로 전체 검색
                    if (!(attachmentFile instanceof TFile)) {
                        console.log("첨부파일을 상대경로에서 찾을 수 없음. 이름으로 검색:");
                        
                        // 볼트 내 모든 파일 중에서 이름이 일치하는 파일 검색
                        const fileName = originalPath.split('/').pop() || originalPath;
                        const files = this.app.vault.getAllLoadedFiles();
                        const matchingFiles = files.filter(file => 
                            file instanceof TFile && file.name === fileName
                        ) as TFile[];
                        
                        if (matchingFiles.length > 0) {
                            attachmentFile = matchingFiles[0];
                            console.log("이름 검색으로 첨부파일 찾음:", attachmentFile.path);
                        } else {
                            console.log("첨부파일을 찾을 수 없음. 건너뜀");
                            continue;
                        }
                    }
                    
                    // 첨부파일을 찾았을 때
                    if (attachmentFile instanceof TFile) {
                        // 파일명만 추출 (경로 제외)
                        const fileName = attachmentFile.name;
                        console.log("추출된 파일명:", fileName);
                        
                        // 형식이 올바른지 다시 확인
                        const finalFileNameMatch = fileName.match(fileNamePattern);
                        
                        // 이미 현재 노트에 맞는 타임스탬프로 되어 있으면 스킵
                        if (finalFileNameMatch && finalFileNameMatch[1] === currentNoteTimestamp) {
                            console.log("이미 현재 노트에 맞게 이름이 변경된 파일:", fileName);
                            continue;
                        }

                        let counter = 1;
                        let newFileName;
                        let newPath;
                        
                        // 중복되지 않는 파일 이름을 찾을 때까지 반복
                        do {
                            newFileName = `${currentNoteTimestamp}-${counter}.${attachmentFile.extension}`;
                            // 현재 노트와 동일한 폴더에 저장
                            newPath = normalizePath(`${currentFile.parent?.path || ""}/${newFileName}`);
                            counter++;
                        } while (this.app.vault.getAbstractFileByPath(newPath));
                        
                        console.log("새 경로:", newPath);
                        
                        // 파일 이름 변경
                        await this.app.fileManager.renameFile(attachmentFile, newPath);
                        
                        // 링크 업데이트 - 현재 노트의 상대 경로로 설정
                        const newEmbed = `![[${newFileName}]]`;
                        updatedContent = updatedContent.replace(originalEmbed, newEmbed);
                        changedCount++;
                    }
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
    
    // 두 경로 간의 상대 경로 계산
    private getRelativePath(sourcePath: string, targetPath: string): string {
        // 경로를 배열로 분할
        const sourceParts = sourcePath.split('/');
        const targetParts = targetPath.split('/');
        
        // 소스 파일 이름 제거 (디렉토리 경로만 남김)
        sourceParts.pop();
        
        // 타겟의 파일 이름 저장
        const targetFileName = targetParts.pop() || '';
        
        // 공통 경로 찾기
        let commonIndex = 0;
        const minLength = Math.min(sourceParts.length, targetParts.length);
        
        while (commonIndex < minLength && sourceParts[commonIndex] === targetParts[commonIndex]) {
            commonIndex++;
        }
        
        // 소스에서 타겟으로 가는 상대 경로 구성
        const relativeParts = [];
        
        // 상위 디렉토리로 이동 (..)
        for (let i = commonIndex; i < sourceParts.length; i++) {
            relativeParts.push('..');
        }
        
        // 타겟 디렉토리로 이동
        for (let i = commonIndex; i < targetParts.length; i++) {
            relativeParts.push(targetParts[i]);
        }
        
        // 파일 이름 추가
        relativeParts.push(targetFileName);
        
        return relativeParts.join('/');
    }
}
