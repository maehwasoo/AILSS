import { Editor, Notice, requestUrl, RequestUrlParam } from 'obsidian';
import AILSSPlugin from 'main';
import { OpenAITTS } from './openai_tts';

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
            
            // 텍스트를 자연스러운 대화체로 변환
            const naturalText = await this.convertToNaturalSpeech(selectedText);
            
            if (!naturalText) {
                new Notice('텍스트 변환에 실패했습니다.');
                return;
            }
            
            new Notice('자연스러운 대화체 변환 완료. TTS 변환 중...');
            
            // 선택한 텍스트를 변환된 대화체 텍스트로 임시 대체
            const selections = editor.listSelections();
            if (selections.length > 0) {
                const lastSelection = selections[selections.length - 1];
                const tempEditor = {
                    getSelection: () => naturalText,
                    listSelections: () => editor.listSelections(),
                    replaceRange: (text: string, range: any) => editor.replaceRange(text, range),
                    getLine: (line: number) => editor.getLine(line)
                };
                
                // OpenAITTS를 사용하여 변환된 텍스트를 TTS로 처리
                await this.openaiTTS.convertTextToSpeech(tempEditor as Editor);
            }
            
        } catch (error) {
            console.error('자연 음성 변환 중 오류:', error);
            new Notice(`자연 음성 변환 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        }
    }
    
    /**
     * 텍스트를 자연스러운 대화체로 변환
     */
    private async convertToNaturalSpeech(text: string): Promise<string> {
        // AI 모델이 선택되어 있지 않거나 API 키가 없는 경우 에러
        const selectedModel = this.plugin.settings.selectedAIModel;
        if (!selectedModel) {
            throw new Error('AI 모델이 선택되지 않았습니다.');
        }
        
        let apiKey = '';
        let endpoint = '';
        let requestBody: any = {};
        let headers: Record<string, string> = {};
        
        // 선택된 AI 모델에 따라 API 호출 방식 결정
        switch (selectedModel) {
            case 'openai':
                apiKey = this.plugin.settings.openAIAPIKey;
                if (!apiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다.');
                
                endpoint = 'https://api.openai.com/v1/chat/completions';
                headers = {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                };
                requestBody = {
                    model: this.plugin.settings.openAIModel,
                    messages: [
                        {
                            role: "system",
                            content: "당신은 텍스트를 자연스러운 대화체로 변환하는 전문가입니다. 주어진 텍스트를 가능한 자연스러운 한국어 대화체 설명으로 변환하세요. 원본 의미를 유지하되, 딱딱하거나 복잡한 표현은 일상적인 대화처럼 바꿔주세요. 내용이 압축적이고 요약된 경우에는 적절히 풀어서 설명하세요. 단, 주제에서 벗어나지 않도록 하세요."
                        },
                        {
                            role: "user",
                            content: text
                        }
                    ],
                    temperature: 0.7
                };
                break;
                
            case 'claude':
                apiKey = this.plugin.settings.claudeAPIKey;
                if (!apiKey) throw new Error('Claude API 키가 설정되지 않았습니다.');
                
                endpoint = 'https://api.anthropic.com/v1/messages';
                headers = {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                };
                requestBody = {
                    model: this.plugin.settings.claudeModel,
                    messages: [
                        {
                            role: "user",
                            content: `당신은 텍스트를 자연스러운 대화체로 변환하는 전문가입니다. 주어진 텍스트를 가능한 자연스러운 한국어 대화체 설명으로 변환하세요. 원본 의미를 유지하되, 딱딱하거나 복잡한 표현은 일상적인 대화처럼 바꿔주세요. 내용이 압축적이고 요약된 경우에는 적절히 풀어서 설명하세요. 단, 주제에서 벗어나지 않도록 하세요.\n\n텍스트: ${text}`
                        }
                    ],
                    max_tokens: 4000
                };
                break;
                
            case 'perplexity':
                apiKey = this.plugin.settings.perplexityAPIKey;
                if (!apiKey) throw new Error('Perplexity API 키가 설정되지 않았습니다.');
                
                endpoint = 'https://api.perplexity.ai/chat/completions';
                headers = {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                };
                requestBody = {
                    model: this.plugin.settings.perplexityModel,
                    messages: [
                        {
                            role: "system",
                            content: "당신은 텍스트를 자연스러운 대화체로 변환하는 전문가입니다. 주어진 텍스트를 가능한 자연스러운 한국어 대화체 설명으로 변환하세요. 원본 의미를 유지하되, 딱딱하거나 복잡한 표현은 일상적인 대화처럼 바꿔주세요. 내용이 압축적이고 요약된 경우에는 적절히 풀어서 설명하세요. 단, 주제에서 벗어나지 않도록 하세요."
                        },
                        {
                            role: "user",
                            content: text
                        }
                    ]
                };
                break;
                
            case 'google':
                apiKey = this.plugin.settings.googleAIAPIKey;
                if (!apiKey) throw new Error('Google AI API 키가 설정되지 않았습니다.');
                
                endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + 
                           this.plugin.settings.googleAIModel + ':generateContent?key=' + apiKey;
                headers = {
                    'Content-Type': 'application/json'
                };
                requestBody = {
                    contents: [
                        {
                            role: "user",
                            parts: [
                                {
                                    text: `당신은 텍스트를 자연스러운 대화체로 변환하는 전문가입니다. 주어진 텍스트를 가능한 자연스러운 한국어 대화체 설명으로 변환하세요. 원본 의미를 유지하되, 딱딱하거나 복잡한 표현은 일상적인 대화처럼 바꿔주세요. 내용이 압축적이고 요약된 경우에는 적절히 풀어서 설명하세요. 단, 주제에서 벗어나지 않도록 하세요.\n\n텍스트: ${text}`
                                }
                            ]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 4000
                    }
                };
                break;
                
            default:
                throw new Error('지원되지 않는 AI 모델입니다.');
        }
        
        // API 요청
        try {
            const params: RequestUrlParam = {
                url: endpoint,
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody),
                contentType: 'application/json',
                throw: false
            };
            
            const response = await requestUrl(params);
            
            if (response.status !== 200) {
                console.error('API 응답 오류:', response.text);
                throw new Error(`API 응답 오류: ${response.status}`);
            }
            
            // AI 제공자별 응답 형식에 따라 결과 추출
            let result = '';
            const responseJson = response.json;
            
            switch (selectedModel) {
                case 'openai':
                    result = responseJson.choices[0].message.content;
                    break;
                    
                case 'claude':
                    result = responseJson.content[0].text;
                    break;
                    
                case 'perplexity':
                    result = responseJson.choices[0].message.content;
                    break;
                    
                case 'google':
                    result = responseJson.candidates[0].content.parts[0].text;
                    break;
            }
            
            return result.trim();
            
        } catch (error) {
            console.error('자연 음성 변환 API 요청 중 오류:', error);
            throw error;
        }
    }
}