import { App, Editor, MarkdownView } from 'obsidian';

export class AIEditorUtils {
    static getActiveEditor(app: App): Editor {
        const activeView = app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            throw new Error('활성화된 마크다운 편집기가 없습니다.');
        }
        return activeView.editor;
    }

    static async insertAfterSelection(editor: Editor, content: string): Promise<void> {
        const selections = editor.listSelections();
        const lastSelection = selections[selections.length - 1];
        const endPos = lastSelection.head.line > lastSelection.anchor.line ? 
            lastSelection.head : lastSelection.anchor;

        editor.replaceRange('\n\n' + content + '\n',
            {line: endPos.line, ch: editor.getLine(endPos.line).length});
    }

    static async updateNoteContent(content: string, analyses: string[]): Promise<string> {
        //console.log('노트 내용 업데이트 시작');
        const imageRegex = /!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp))\]\]/g;
        let lastIndex = 0;
        let result = '';
        let analysisIndex = 0;

        //console.log('분석할 내용:', analyses);
        
        const matches = [...content.matchAll(imageRegex)];
        //console.log('찾은 이미지 매치:', matches);
        
        for (const match of matches) {
            result += content.slice(lastIndex, match.index);
            result += match[0];
            result += '\n#\ analysis\n' + analyses[analysisIndex] + '\n';
            
            lastIndex = match.index! + match[0].length;
            analysisIndex++;
        }

        result += content.slice(lastIndex);
        return result;
    }
}