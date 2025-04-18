import { App, Notice } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { AIImageUtils } from '../ai_utils/aiImageUtils';
import { AIEditorUtils } from '../ai_utils/aiEditorUtils';
import { AIBatchProcessor } from '../ai_utils/aiBatchProcessor';
import { AIVisionAPI } from '../ai_utils/aiVisionAPI';

export class AIOCR {
    private app: App;
    private plugin: AILSSPlugin;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async main() {
        try {
            new Notice('OCR 분석 프로세스 시작');
            const editor = AIEditorUtils.getActiveEditor(this.app);
            const selectedText = editor.getSelection();
            
            if (!selectedText) {
                new Notice('이미지를 선택해주세요.');
                return;
            }

            const imageLinks = AIImageUtils.extractImageLinks(selectedText);
            new Notice(`발견된 이미지 링크: ${imageLinks.length}개`);

            if (imageLinks.length === 0) {
                new Notice('선택된 텍스트에서 이미지를 찾을 수 없습니다.');
                return;
            }

            new Notice('이미지 분석을 시작합니다...');
            const analyses = await AIBatchProcessor.processBatch(
                imageLinks,
                async (link, index, total) => {
                    return await this.analyzeImage(link);
                },
                3,
                '이미지 분석'
            );

            new Notice('분석된 내용을 노트에 추가하는 중...');
            const updatedSelection = await AIEditorUtils.updateNoteContent(selectedText, analyses);
            editor.replaceSelection(updatedSelection);

            new Notice('이미지 분석이 완료되었습니다.');
        } catch (error) {
            new Notice('이미지 분석 중 오류가 발생했습니다.');
        }
    }

    private async analyzeImage(imagePath: string): Promise<string> {
        try {
            // 공통 Vision API 사용하여 이미지 분석 (OCR 모드로 설정)
            return await AIVisionAPI.analyzeImage(
                this.app,
                this.plugin,
                imagePath,
                "", // OCR 모드에서는 지시문 필요 없음
                true // OCR 모드 활성화
            );
        } catch (error: any) {
            // API 오류 처리
            console.error('OCR 분석 오류:', error);
            new Notice(`OCR 분석 중 오류가 발생했습니다: ${error.message}`);
            return `이미지 분석 중 오류가 발생했습니다: ${error.message}`;
        }
    }
}
