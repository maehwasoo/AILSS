import { requestUrl, RequestUrlParam, Notice, TFile, MarkdownView } from 'obsidian';
import AILSSPlugin from '../../../../main';

interface ImageGenerationResponse {
    created: number;
    data: Array<{
        url: string;
        revised_prompt?: string;
    }>;
}

interface GoogleImageGenerationResponse {
    name?: string;
    images: Array<{
        base64Data: string;
    }>;
    promptFeedback?: {
        promptQuality?: string;
        safetyRatings?: Array<{
            category: string;
            probability: string;
        }>;
    };
}

export class AIImageCreator {
    constructor(private plugin: AILSSPlugin) {}

    private async getNextImageIndex(baseName: string): Promise<number> {
        const files = this.plugin.app.vault.getFiles();
        let maxIndex = 0;
        const pattern = new RegExp(`^${baseName}-(\\d+)\\.png$`);

        for (const file of files) {
            const match = file.name.match(pattern);
            if (match) {
                const index = parseInt(match[1]);
                maxIndex = Math.max(maxIndex, index);
            }
        }

        return maxIndex + 1;
    }

    private getCurrentNoteName(): string {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            throw new Error('활성화된 노트가 없습니다.');
        }
        return activeFile.basename;
    }

    async main(customPrompt?: string) {
        console.log('main 메소드 시작', { customPrompt });
        const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            console.log('활성화된 마크다운 편집기 없음');
            new Notice('활성화된 마크다운 편집기가 없습니다.');
            return;
        }

        const editor = activeView.editor;
        const selectedText = customPrompt || editor.getSelection();
        console.log('선택된 텍스트:', selectedText);

        if (!selectedText && !customPrompt) {
            console.log('프롬프트 없음');
            new Notice('이미지를 생성할 프롬프트를 선택해주세요.');
            return;
        }

        try {
            console.log('이미지 생성 시도:', selectedText || '귀여운 고양이');
            const imageUrls = await this.generateImage(selectedText || '귀여운 고양이');
            console.log('생성된 이미지 URLs:', imageUrls);
            
            for (const imageUrl of imageUrls) {
                console.log('이미지 저장 시도');
                const savedPath = await this.saveImageToVault(imageUrl);
                console.log('저장된 이미지 경로:', savedPath);
                
                if (selectedText) {
                    const selections = editor.listSelections();
                    const lastSelection = selections[selections.length - 1];
                    const endPos = lastSelection.head.line > lastSelection.anchor.line ? 
                        lastSelection.head : lastSelection.anchor;

                    editor.replaceRange(`\n![[${savedPath}]]\n`,
                        {line: endPos.line, ch: editor.getLine(endPos.line).length});
                }
            }
        } catch (error) {
            console.error('이미지 생성 오류:', error);
            if (error instanceof Error) {
                new Notice(`이미지 생성 실패: ${error.message}`);
            } else {
                new Notice('이미지 생성 중 알 수 없는 오류가 발생했습니다.');
            }
        }
    }

    private async generateImage(prompt: string, size: '1024x1024' | '1792x1024' | '1024x1792' = '1024x1024'): Promise<string[]> {
        console.log('generateImage 시작', { prompt, size });
        const model = this.plugin.settings.imageGenerationModel;
        
        console.log('API 설정 확인:', { model });
        
        // Google Imagen 모델 처리
        if (model === 'imagen-3.0-generate-002') {
            return this.generateImageWithGoogle(prompt, size);
        }
        
        // OpenAI DALL-E 모델 처리 (기존 코드)
        const apiKey = this.plugin.settings.openAIAPIKey;
        
        if (!apiKey) {
            throw new Error('OpenAI API 키가 설정되지 않았습니다.');
        }

        new Notice('이미지 생성 시작...');

        const url = 'https://api.openai.com/v1/images/generations';
        const headers = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        };

        // DALL-E 3의 경우 병렬 요청으로 3개 생성
        if (model === 'dall-e-3') {
            const requests = Array(3).fill(null).map(() => {
                const data = {
                    model: model,
                    prompt: prompt,
                    n: 1,
                    size: size,
                    quality: 'hd',
                    response_format: 'url'
                };

                return requestUrl({
                    url: url,
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(data)
                });
            });

            try {
                console.log('DALL-E 3 병렬 요청 시작');
                const responses = await Promise.all(requests);
                const urls = responses.map(response => {
                    const result = response.json as ImageGenerationResponse;
                    if (result.data[0].revised_prompt) {
                        new Notice(`수정된 프롬프트: ${result.data[0].revised_prompt}`, 5000);
                    }
                    return result.data[0].url;
                });
                new Notice('이미지가 성공적으로 생성되었습니다.');
                return urls;
            } catch (error) {
                console.error('API 요청 오류:', error);
                throw new Error(`이미지 생성 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
            }
        } 
        // DALL-E 2의 경우 한 번에 5개 생성
        else {
            const data = {
                model: model,
                prompt: prompt,
                n: 5,
                size: size,
                response_format: 'url'
            };

            try {
                console.log('DALL-E 2 요청 시작', { url, data });
                const response = await requestUrl({
                    url: url,
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(data)
                });
                
                if (response.status === 200) {
                    const result = response.json as ImageGenerationResponse;
                    new Notice('이미지가 성공적으로 생성되었습니다.');
                    return result.data.map(item => item.url);
                } else {
                    throw new Error(`API 응답 오류: ${response.status}`);
                }
            } catch (error) {
                console.error('API 요청 오류:', error);
                throw new Error(`이미지 생성 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
            }
        }
    }

    private async generateImageWithGoogle(prompt: string, size: string): Promise<string[]> {
        console.log('Google Imagen 이미지 생성 시작', { prompt, size });
        const apiKey = this.plugin.settings.googleAIAPIKey;
        
        if (!apiKey) {
            throw new Error('Google AI API 키가 설정되지 않았습니다.');
        }

        new Notice('Google Imagen으로 이미지 생성 시작...');

        // Google Imagen API 엔드포인트
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:generateContent';
        
        // 크기 설정 변환
        let sampleImageSize: {width: number, height: number};
        
        switch (size) {
            case '1024x1024':
                sampleImageSize = { width: 1024, height: 1024 };
                break;
            case '1792x1024':
                sampleImageSize = { width: 1792, height: 1024 };
                break;
            case '1024x1792':
                sampleImageSize = { width: 1024, height: 1792 };
                break;
            default:
                sampleImageSize = { width: 1024, height: 1024 };
        }

        // Google Imagen API 요청 본문
        const data = {
            contents: [{
                parts: [{
                    text: prompt
                }]
            }],
            generation_config: {
                sample_image_size: sampleImageSize,
                candidates_count: 3  // 3개의 이미지 생성
            }
        };

        try {
            console.log('Google Imagen 요청 시작', { url, data });
            // API 요청
            const response = await requestUrl({
                url: `${url}?key=${apiKey}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
            
            if (response.status === 200) {
                const responseData = response.json;
                
                if (responseData.candidates && responseData.candidates.length > 0) {
                    const images = [];
                    
                    // 생성된 각 이미지에 대해 처리
                    for (const candidate of responseData.candidates) {
                        if (candidate.content && candidate.content.parts) {
                            for (const part of candidate.content.parts) {
                                if (part.inlineData && part.inlineData.data) {
                                    // Base64 이미지 데이터를 임시 data:URI로 변환
                                    const imageUrl = `data:image/png;base64,${part.inlineData.data}`;
                                    images.push(imageUrl);
                                }
                            }
                        }
                    }
                    
                    if (images.length > 0) {
                        new Notice('이미지가 성공적으로 생성되었습니다.');
                        return images;
                    }
                }
                
                throw new Error('이미지 데이터를 찾을 수 없습니다.');
            } else {
                throw new Error(`API 응답 오류: ${response.status}`);
            }
        } catch (error) {
            console.error('Google Imagen API 요청 오류:', error);
            throw new Error(`이미지 생성 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        }
    }

    private async saveImageToVault(imageUrl: string): Promise<string> {
        try {
            // data:URI 형식인지 확인 (Google Imagen의 결과)
            if (imageUrl.startsWith('data:')) {
                const base64Data = imageUrl.split(',')[1];
                const arrayBuffer = this.base64ToArrayBuffer(base64Data);
                
                const activeFile = this.plugin.app.workspace.getActiveFile();
                if (!activeFile) {
                    throw new Error('활성화된 노트를 찾을 수 없습니다.');
                }
                
                const currentFolder = activeFile.parent?.path || '';
                const baseName = activeFile.basename;
                const nextIndex = await this.getNextImageIndex(baseName);
                
                const fullPath = `${currentFolder}${currentFolder ? '/' : ''}${baseName}-${nextIndex}.png`;
                console.log('이미지 저장 경로:', fullPath);
                
                await this.plugin.app.vault.createBinary(fullPath, arrayBuffer);
                
                const linkPath = `${baseName}-${nextIndex}.png`;
                
                new Notice(`이미지가 저장되었습니다: ${fullPath}`);
                return linkPath;
            } else {
                // 기존 URL 기반 이미지 저장 로직
                const response = await requestUrl({
                    url: imageUrl,
                    method: 'GET'
                });

                const arrayBuffer = response.arrayBuffer;
                const activeFile = this.plugin.app.workspace.getActiveFile();
                if (!activeFile) {
                    throw new Error('활성화된 노트를 찾을 수 없습니다.');
                }

                // 현재 노트의 경로에서 파일명을 제외한 디렉토리 경로 가져오기
                const currentFolder = activeFile.parent?.path || '';
                const baseName = activeFile.basename;
                const nextIndex = await this.getNextImageIndex(baseName);
                
                // 실제 저장 경로는 현재 폴더 경로를 포함
                const fullPath = `${currentFolder}${currentFolder ? '/' : ''}${baseName}-${nextIndex}.png`;
                console.log('이미지 저장 경로:', fullPath);
                
                await this.plugin.app.vault.createBinary(fullPath, arrayBuffer);
                
                // 링크용 경로는 파일명만 반환
                const linkPath = `${baseName}-${nextIndex}.png`;
                
                new Notice(`이미지가 저장되었습니다: ${fullPath}`);
                return linkPath;
            }
        } catch (error) {
            console.error('이미지 저장 중 오류:', error);
            throw new Error(`이미지 저장 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        }
    }
    
    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
}
