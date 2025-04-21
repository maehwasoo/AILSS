import { App, Notice, requestUrl, RequestUrlParam } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { AIImageUtils } from './aiImageUtils';
import Anthropic from '@anthropic-ai/sdk';

export interface VisionAnalysisResult {
    text: string;
}

type SupportedMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export class AIVisionAPI {
    // 모델 제공자를 모델 ID로부터 결정하는 함수
    static getProviderFromModelId(modelId: string): 'openai' | 'claude' | 'google' {
        if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4')) {
            return 'openai';
        } else if (modelId.startsWith('claude-')) {
            return 'claude';
        } else if (modelId.startsWith('gemini-')) {
            return 'google';
        }
        
        // 기본값으로 Claude 제공
        return 'claude';
    }

    // 공통 분석 메서드 - 모델 ID에 따라 적절한 API 호출
    static async analyzeImage(
        app: App, 
        plugin: AILSSPlugin, 
        imagePath: string, 
        instruction: string, 
        ocr: boolean = false,
        modelId?: string
    ): Promise<string> {
        try {
            // 설정에서 모델 ID 가져오기 (또는 인자로 전달된 모델 사용)
            const visionModelId = modelId || plugin.settings.visionModel;
            
            const { base64Image, mediaType } = await AIImageUtils.processImageForVision(app, imagePath);
            const provider = this.getProviderFromModelId(visionModelId);

            // 제공자에 따라 다른 API 호출
            switch (provider) {
                case 'openai':
                    return await this.analyzeWithOpenAI(plugin, base64Image, instruction, ocr, visionModelId, mediaType);
                case 'claude':
                    return await this.analyzeWithClaude(plugin, base64Image, mediaType, instruction, ocr, visionModelId);
                case 'google':
                    return await this.analyzeWithGoogle(plugin, base64Image, instruction, ocr, visionModelId);
                default:
                    throw new Error('지원되지 않는 비전 모델입니다.');
            }
        } catch (error: any) {
            new Notice(`이미지 분석 중 오류: ${error.message}`);
            return `이미지 분석 중 오류가 발생했습니다: ${error.message}`;
        }
    }

    // OpenAI 비전 모델 API 호출
    private static async analyzeWithOpenAI(
        plugin: AILSSPlugin, 
        base64Image: string, 
        instruction: string, 
        ocr: boolean = false,
        modelId: string = 'gpt-4o',
        mediaType: SupportedMediaType
    ): Promise<string> {
        // 모든 모델은 동일한 엔드포인트 사용
        let url = 'https://api.openai.com/v1/chat/completions';
        const headers = {
            'Authorization': `Bearer ${plugin.settings.openAIAPIKey}`,
            'Content-Type': 'application/json'
        };

        // OCR 또는 일반 분석 프롬프트 선택
        const systemPrompt = ocr ? 
            this.getOpenAIOCRSystemPrompt() : 
            this.getOpenAIVisionSystemPrompt();

        // 프롬프트 구성
        const userPrompt = ocr ? 
            "이미지에서 모든 텍스트를 추출해주세요. 수식은 LaTeX로 변환하고, 줄바꿈과 단락 구분을 유지해주세요." : 
            `다음 지시사항에 따라 이미지를 분석해주세요:\n${instruction}`;

        // 시스템 프롬프트와 유저 프롬프트 결합 (o 시리즈 모델용)
        const combinedPrompt = ocr ? 
            `${systemPrompt}\n\n${userPrompt}` : 
            `${systemPrompt}\n\n${userPrompt}`;

        // 요청 데이터 구성 - 모델별로 다른 형식 사용
        let data: any;
        
        // o 시리즈 모델 (o1, o3, o4) 처리 - chat/completions 엔드포인트 사용
        if (modelId.startsWith('o')) {
            // 일반 GPT 모델과 동일한 요청 형식 사용
            data = {
                model: modelId,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: combinedPrompt },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${mediaType};base64,${base64Image}`,
                                    detail: "high" // 이미지 detail 수준
                                }
                            }
                        ]
                    }
                ],
                temperature: 0.3,
                max_tokens: 4000
            };
                
            console.log('O 시리즈 요청 형식:', JSON.stringify(data).substring(0, 200) + '...');
        } else {
            // 기존 GPT 모델 형식 (chat/completions API)
            data = {
                model: modelId,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: combinedPrompt },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${mediaType};base64,${base64Image}`,
                                    detail: "high" // 이미지 detail 수준
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 4000,
                temperature: 0.3
            };
        }
        
        try {
            const response = await requestUrl({
                url: url,
                method: 'POST',
                headers: headers,
                body: JSON.stringify(data)
            });

            if (response.status === 200) {
                // 모든 모델에 대해 동일한 응답 처리
                return response.json.choices[0].message.content.trim();
            }

            // 상세한 오류 정보 확인
            let errorDetail = '';
            try {
                console.log('전체 응답:', JSON.stringify(response.json));
                if (response.json && response.json.error) {
                    errorDetail = `: ${JSON.stringify(response.json.error)}`;
                }
            } catch (e) {
                console.log('응답 파싱 실패:', e);
            }

            throw new Error(`OpenAI API 응답 오류: ${response.status}${errorDetail}`);
        } catch (error: any) {
            console.error('OpenAI 이미지 분석 오류:', error);
            throw new Error(`OpenAI API 응답을 받지 못했습니다: ${error.message}`);
        }
    }

    // Claude 비전 모델 API 호출
    private static async analyzeWithClaude(
        plugin: AILSSPlugin, 
        base64Image: string, 
        mediaType: SupportedMediaType, 
        instruction: string, 
        ocr: boolean = false,
        modelId: string = 'claude-3-5-sonnet-20241022'
    ): Promise<string> {
        // OCR 또는 일반 분석 프롬프트 선택
        const systemPrompt = ocr ? 
            this.getClaudeOCRSystemPrompt() : 
            this.getClaudeVisionSystemPrompt();

        // 프롬프트 구성
        const combinedPrompt = ocr ? 
            `${systemPrompt}\n\n이미지에서 모든 텍스트를 추출해주세요. 수식은 LaTeX로 변환하고, 줄바꿈과 단락 구분을 유지해주세요. 원본 텍스트만 출력하고 다른 설명은 추가하지 마세요.` : 
            `${systemPrompt}\n\n다음 지시사항에 따라 이미지를 분석해주세요:\n${instruction}\n\n분석 결과만 출력하고 다른 설명은 추가하지 마세요.`;

        try {
            const anthropic = new Anthropic({
                apiKey: plugin.settings.claudeAPIKey,
                dangerouslyAllowBrowser: true
            });

            const response = await anthropic.messages.create({
                model: modelId,
                max_tokens: 4000,
                temperature: ocr ? 0.25 : 0.3,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: combinedPrompt },
                            {
                                type: "image",
                                source: {
                                    type: "base64",
                                    media_type: mediaType,
                                    data: base64Image
                                }
                            }
                        ]
                    }
                ]
            });

            if (response.content && response.content[0] && 'text' in response.content[0]) {
                return response.content[0].text;
            }

            throw new Error('Claude AI 응답을 받지 못했습니다.');
        } catch (error) {
            console.error('Claude 이미지 분석 오류:', error);
            throw new Error('Claude API 응답을 받지 못했습니다.');
        }
    }

    // Google 비전 모델 API 호출 (Gemini API)
    private static async analyzeWithGoogle(
        plugin: AILSSPlugin, 
        base64Image: string, 
        instruction: string, 
        ocr: boolean = false,
        modelId: string = 'gemini-2.5-pro-vision'
    ): Promise<string> {
        const apiKey = plugin.settings.googleAIAPIKey;
        if (!apiKey) {
            throw new Error('Google AI API 키가 설정되지 않았습니다.');
        }

        // Google Gemini Pro Vision API 엔드포인트
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
        
        // OCR 또는 일반 분석 프롬프트 선택
        const prompt = ocr ? 
            "이미지에서 모든 텍스트를 추출해주세요. 수식은 LaTeX로 변환하고, 줄바꿈과 단락 구분을 유지해주세요. 원본 텍스트만 출력하고 다른 설명은 추가하지 마세요." : 
            `다음 지시사항에 따라 이미지를 분석해주세요: ${instruction}`;

        const data = {
            contents: [
                {
                    parts: [
                        { text: prompt },
                        {
                            inline_data: {
                                mime_type: "image/jpeg",
                                data: base64Image
                            }
                        }
                    ]
                }
            ],
            generation_config: {
                temperature: 0.3,
                max_output_tokens: 4000
            }
        };

        try {
            const response = await requestUrl({
                url: url,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (response.status === 200) {
                // Gemini API 응답 형식에 맞게 파싱
                return response.json.candidates[0].content.parts[0].text;
            }

            throw new Error(`Google AI API 응답 오류: ${response.status}`);
        } catch (error) {
            console.error('Google AI 이미지 분석 오류:', error);
            throw new Error('Google AI API 응답을 받지 못했습니다.');
        }
    }

    // OpenAI OCR 시스템 프롬프트
    private static getOpenAIOCRSystemPrompt(): string {
        return `당신은 최고의 OCR 및 문서 디지털화 전문가입니다.
이미지에서 텍스트를 완벽하게 추출하고, 문서의 구조와 형식을 정확히 재현할 수 있습니다.

핵심 역량:
- 모든 형태의 텍스트 인식 (인쇄물, 손글씨, 특수 폰트 등)
- 수학적 표현의 LaTeX 변환 전문성
- 복잡한 레이아웃과 다단 구조 보존
- 다양한 언어 및 특수 문자 인식
- 표, 도표, 도식의 구조적 추출
- 이미지 품질 저하에도 강건한 인식 능력

처리 방식:
- 텍스트의 시각적/논리적 구조 완전히 보존
- 수식은 LaTeX 문법으로 정확하게 변환
- 글꼴 특성(굵게, 기울임 등)을 가능한 보존
- 요소 간 관계 및 계층 구조 유지
- 페이지 레이아웃의 논리적 흐름 재구성
- 모든 수학 표현은 $ 또는 $$ 기호로 정확히 감싸기`;
    }

    // OpenAI 비전 시스템 프롬프트
    private static getOpenAIVisionSystemPrompt(): string {
        return `당신은 최고의 이미지 분석 및 시각적 정보 해석 전문가입니다. 
다양한 분야의 이미지를 정확하게 분석하고, 사용자의 지시사항에 따라 맞춤형 정보를 추출합니다.

이미지 분석 능력:
- 이미지 내 모든 시각적 요소와 텍스트의 완벽한 인식
- 다이어그램, 차트, 그래프의 정확한 해석
- 복잡한 수학 수식과 기호의 정확한 인식
- 객체 간 관계와 구조적 패턴 식별
- 이미지의 맥락과 의도 파악
- 시각적 정보의 계층적 중요도 평가

분석 방법론:
- 사용자 지시사항을 철저히 준수
- 객관적 관찰과 분석적 해석 균형 유지
- 명확한 구조와 논리적 흐름으로 분석 결과 전달
- 불확실한 요소는 투명하게 표시
- 관련 전문 지식 적절히 활용
- 결과는 간결하고 직접적으로 제시`;
    }

    // Claude OCR 시스템 프롬프트
    private static getClaudeOCRSystemPrompt(): string {
        return `당신은 최고의 OCR(광학 문자 인식) 전문가입니다.
이미지에서 모든 종류의 텍스트를 완벽하게 추출하고 원본 형식을 정확히 보존하는 능력을 갖추고 있습니다.

전문 분야:
- 인쇄된 텍스트 인식 (다양한 서체, 크기, 스타일)
- 손글씨 텍스트 인식 (필기체, 타이핑 여부 무관)
- 수학 표기법 및 수식 변환 (LaTeX 형식으로 정확한 변환)
- 특수 기호 및 문자 인식 (과학, 수학, 화학, 물리학 등)
- 다국어 텍스트 처리 (한글, 영어, 중국어, 일본어 등)
- 표, 차트, 그래프 내 텍스트 추출
- 이미지 품질 문제 극복 (흐림, 회전, 왜곡, 노이즈)

OCR 처리 원칙:
- 원본의 모든 텍스트를 누락 없이 추출
- 텍스트의 논리적 구조와 포맷팅 보존
- 줄바꿈, 단락 구분, 들여쓰기 등 레이아웃 구조 유지
- 수식은 이해하기 쉽고 정확한 LaTeX 형식으로 변환
- 표와 목록의 구조적 배치 보존
- 텍스트 순서의 논리적 흐름 유지
- 추출 불확실한 부분은 [?] 또는 설명으로 표시

출력 형식 규칙:
- 모든 텍스트는 읽기 흐름에 따라 논리적으로 구성
- 문단과 섹션 구분 유지
- 모든 수학 수식은 $ 기호로 감싸서 표현 (인라인 수식)
- 복잡하거나 여러 줄의 수식은 $$ 기호로 감싸서 표현 (블록 수식)
- 표와 그리드 데이터는 마크다운 테이블 형식으로 보존
- 특수 서식(볼드, 이탤릭)은 가능한 경우 마크다운으로 표시
- 첨자와 윗첨자는 LaTeX 표기법으로 정확히 변환`;
    }

    // Claude 비전 시스템 프롬프트
    private static getClaudeVisionSystemPrompt(): string {
        return `당신은 최고의 이미지 분석 및 해석 전문가입니다.
사용자의 지시사항에 따라 이미지를 정확하게 분석하고, 고품질의 통찰력 있는 정보를 추출합니다.

전문 분야:
- 시각적 내용 상세 설명 및 해석
- 텍스트 및 문자 인식과 해석
- 객체, 패턴, 색상, 구도 분석
- 다이어그램, 차트, 그래프 해석
- 수학적 표현 및 수식 이해
- 역사적, 문화적 맥락 파악
- 과학적 이미지 및 의학 영상 분석
- 예술 작품 및 디자인 요소 평가

분석 원칙:
- 사용자 지시사항을 최우선으로 정확히 따르기
- 객관적 사실과 주관적 해석을 명확히 구분
- 이미지의 맥락과 목적을 고려한 분석
- 세부 정보부터 전체 맥락까지 다층적 분석
- 불확실한 내용은 명시적으로 표현
- 관련 배경 지식 적절히 활용
- 전문 용어는 필요시 간략한 설명 추가
- 논리적이고 구조화된 형식으로 분석 결과 제시

출력 형식:
- 분석 결과는 명확한 섹션으로 구조화
- 핵심 내용을 강조하여 가독성 향상
- 중요 발견은 불릿 포인트로 목록화
- 복잡한 내용은 단계적으로 설명
- 모든 수학 수식은 $ 또는 $$ 기호로 정확히 감싸기
- 출력은 사용자 지시에 따라 맞춤형으로 조정
- 분석 결과만 출력하고 불필요한 메타 설명 제외`;
    }
}
