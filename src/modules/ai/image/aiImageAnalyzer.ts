import { App, Notice } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { AIImageUtils } from '../ai_utils/aiImageUtils';
import { AIEditorUtils } from '../ai_utils/aiEditorUtils';
import { AIBatchProcessor } from '../ai_utils/aiBatchProcessor';
import { AIOCR } from './aiOCR';
import { AIVisionAPI } from '../ai_utils/aiVisionAPI';

export class AIImageAnalyzer {
    private app: App;
    private plugin: AILSSPlugin;
    private ocr: AIOCR;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.ocr = new AIOCR(app, plugin);
    }

    async main() {
        try {
            new Notice('이미지 분석 프로세스 시작');
            const editor = AIEditorUtils.getActiveEditor(this.app);
            const selectedText = editor.getSelection();
            
            // 선택된 텍스트에서 지시사항과 이미지 링크 분리
            const imageLinks = AIImageUtils.extractImageLinks(selectedText);
            const instruction = selectedText.replace(/!\[\[.*?\]\]/g, '').trim();

            if (imageLinks.length === 0) {
                new Notice('선택된 텍스트에서 이미지를 찾을 수 없습니다.');
                return;
            }

            // 지시사항이 없는 경우 OCR 모드로 전환
            if (!instruction) {
                await this.ocr.main();
                return;
            }

            new Notice(`발견된 이미지 링크: ${imageLinks.length}개`);
            new Notice('이미지 분석을 시작합니다...');

            const analyses = await AIBatchProcessor.processBatch(
                imageLinks,
                async (link, index, total) => {
                    return await this.analyzeImage(link, instruction);
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

    private async analyzeImage(imagePath: string, instruction: string): Promise<string> {
        try {
            // 공통 Vision API 사용하여 이미지 분석
            return await AIVisionAPI.analyzeImage(
                this.app,
                this.plugin,
                imagePath,
                instruction,
                false // 일반 분석 모드
            );
        } catch (error: any) {
            new Notice('이미지 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            return '이미지 분석 중 오류가 발생했습니다.';
        }
    }
}