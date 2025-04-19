import { App, Notice, MarkdownView } from 'obsidian';
import type AILSSPlugin from 'main';
import { PathSettings } from '../../../core/settings/pathSettings';

export class NewNote {
    constructor(
        private app: App,
        private plugin: AILSSPlugin
    ) {}

    async createNewNote() {
        try {
            // 노트 개수 제한 확인
            if (!(await PathSettings.checkNoteLimit(this.app, this.plugin))) {
                new Notice(`노트 개수가 최대 제한(${PathSettings.MAX_NOTES}개)에 도달했습니다.`);
                return;
            }

            const { file } = await PathSettings.createNote({
                app: this.app,
                frontmatterConfig: {},
                content: '- ',
                isInherited: false
            });

            // 새 탭에서 파일 열기
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.openFile(file);
            
            // 커서를 불렛포인트 뒤로 이동
            const view = leaf.view as MarkdownView;
            if (view.editor) {
                const lastLine = view.editor.lastLine();
                const lineLength = view.editor.getLine(lastLine).length;
                view.editor.setCursor({ line: lastLine, ch: lineLength });
            }

            new Notice(`새 노트가 생성되었습니다`);
            return file;
        } catch (error) {
            new Notice('노트 생성 중 오류가 발생했습니다.');
            console.error('Error creating new note:', error);
            throw error;
        }
    }
}
