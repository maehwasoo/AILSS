import { App, Notice } from 'obsidian';
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
            const bodyContent = this.extractBodyContent(content);
            
            // 새 노트 생성
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
}