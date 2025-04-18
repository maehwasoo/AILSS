import { Editor, Notice } from 'obsidian';
import AILSSPlugin from 'main';
import { OpenAITTS } from './openai_tts';
import { requestToAI } from '../ai_utils/aiUtils';

export class NaturalTTS {
    private plugin: AILSSPlugin;
    private openaiTTS: OpenAITTS;

    constructor(plugin: AILSSPlugin) {
        this.plugin = plugin;
        this.openaiTTS = new OpenAITTS(plugin);
    }

    /**
     * 선택된 텍스트를 자연스러운 대화체로 변환 후 TTS를 통해 오디오로 변환하여 현재 커서 위치에 삽입
     */
    async convertTextToNaturalSpeech(editor: Editor): Promise<void> {
        try {
            // 선택된 텍스트 가져오기
            const selectedText = editor.getSelection();
            
            if (!selectedText) {
                new Notice('변환할 텍스트를 선택해주세요.');
                return;
            }
            
            // 너무 긴 텍스트 확인
            if (selectedText.length > 4000) {
                new Notice('선택된 텍스트가 너무 깁니다. 4000자 이하로 선택해주세요.');
                return;
            }
            
            new Notice('텍스트를 자연스러운 대화체로 변환 중...');
            
            // 텍스트를 자연스러운 대화체로 변환 (aiUtils.ts의 requestToAI 함수 활용)
            const systemPrompt = "당신은 텍스트를 자연스러운 대화체로 변환하는 전문가입니다. 주어진 텍스트를 가능한 자연스러운 한국어 대화체 설명으로 변환하세요. 원본 의미를 유지하되, 딱딱하거나 복잡한 표현은 일상적인 대화처럼 바꿔주세요. 내용이 압축적이고 요약된 경우에는 적절히 풀어서 설명하세요. 단, 주제에서 벗어나지 않도록 하세요.";
            
            const userPrompt = `${systemPrompt}\n\n다음 텍스트를 자연스러운 대화체로 변환해주세요:\n\n${selectedText}`;
            
            // aiUtils.ts의 requestToAI 함수로 대화체 변환
            const naturalText = await requestToAI(this.plugin, {
                userPrompt: userPrompt
            });
            
            if (!naturalText) {
                new Notice('텍스트 변환에 실패했습니다.');
                return;
            }
            
            new Notice('자연스러운 대화체 변환 완료. TTS 변환 중...');
            
            // 선택한 텍스트를 변환된 대화체 텍스트로 임시 대체
            const tempEditor = {
                getSelection: () => naturalText,
                listSelections: () => editor.listSelections(),
                replaceRange: (text: string, range: any) => editor.replaceRange(text, range),
                getLine: (line: number) => editor.getLine(line)
            };
            
            // OpenAITTS를 사용하여 변환된 텍스트를 TTS로 처리
            await this.openaiTTS.convertTextToSpeech(tempEditor as Editor);
            
        } catch (error) {
            console.error('자연 음성 변환 중 오류:', error);
            new Notice(`자연 음성 변환 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        }
    }
}