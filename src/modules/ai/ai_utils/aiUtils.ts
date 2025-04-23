import { requestUrl, RequestUrlParam, Notice } from 'obsidian';
import AILSSPlugin from '../../../../main';
import Anthropic from '@anthropic-ai/sdk';

interface AIPrompt {
    combinedPrompt: string;     // 통합된 프롬프트 (systemPrompt + userPrompt)
    max_tokens?: number;    // 선택적 필드
}

function logAPIRequest(provider: string, prompt: AIPrompt) {
    console.log(`=== ${provider} 요청 정보 ===`);
    console.log('프롬프트:', prompt.combinedPrompt);
    console.log('최대 토큰:', prompt.max_tokens);
    console.log('=====================');
}

function logAPIResponse(provider: string, response: string, usage: any): string {
    const usageInfo = {
        입력_토큰: usage.prompt_tokens || usage.input_tokens || 0,
        출력_토큰: usage.completion_tokens || usage.output_tokens || 0,
        전체_토큰: usage.total_tokens || (usage.input_tokens + usage.output_tokens) || 0
    };

    const usageMessage = `📊 토큰 사용량 (${provider}):\n` +
                        `입력: ${usageInfo.입력_토큰}\n` +
                        `출력: ${usageInfo.출력_토큰}\n` +
                        `전체: ${usageInfo.전체_토큰}`;

    new Notice(usageMessage, 5000);

    return response;
}

export async function requestToAI(plugin: AILSSPlugin, prompt: AIPrompt): Promise<string> {
    console.log('[requestToAI] 함수 시작', { prompt });
    console.log('[requestToAI] 호출됨', { prompt });
    const { selectedAIModel, openAIModel, claudeModel, perplexityModel, googleAIModel, googleAIAPIKey, enableWebSearch } = plugin.settings;
    console.log('[requestToAI] 설정 값', { selectedAIModel, openAIModel, claudeModel, perplexityModel, googleAIModel, googleAIAPIKey, enableWebSearch });
    
    // 모델 이름 결정 로직 수정
    console.log('[requestToAI] 모델 결정 전 selectedAIModel:', selectedAIModel);
    const modelName = selectedAIModel === 'openai' ? openAIModel :
                    selectedAIModel === 'claude' ? claudeModel :
                    selectedAIModel === 'perplexity' ? perplexityModel :
                    selectedAIModel === 'google' ? googleAIModel : 'Unknown Model';
    console.log('[requestToAI] 결정된 모델 이름:', modelName);
    
    // 사용자에게 보여줄 초기 메시지
    console.log('[requestToAI] 사용자 메시지 생성 전');
    const userMessage = `🤖 AI 요청 정보:\n` +
                       `서비스: ${selectedAIModel.toUpperCase()}\n` +
                       `모델: ${modelName}\n` +
                       `처리 중...`;
    console.log('[requestToAI] 생성된 사용자 메시지:', userMessage);
    
    // Notice로 통일
    new Notice(userMessage, 5000);
    console.log('[requestToAI] Notice 전송 완료');

    try {
        console.log('[requestToAI] try 블록 진입, 모델:', selectedAIModel);
        let response = '';
        if (selectedAIModel === 'openai') {
            console.log('[requestToAI] OpenAI 브랜치 호출', { model: openAIModel, enableWebSearch });
            response = await requestToOpenAI(plugin.settings.openAIAPIKey, prompt, openAIModel, enableWebSearch);
            console.log('[requestToAI] OpenAI 응답 수신:', response);
        } else if (selectedAIModel === 'claude') {
            console.log('[requestToAI] Claude 브랜치 호출', { model: claudeModel });
            response = await requestToClaude(plugin.settings.claudeAPIKey, prompt, claudeModel);
            console.log('[requestToAI] Claude 응답 수신:', response);
        } else if (selectedAIModel === 'perplexity') {
            console.log('[requestToAI] Perplexity 브랜치 호출', { model: perplexityModel });
            response = await requestToPerplexity(plugin.settings.perplexityAPIKey, prompt, perplexityModel);
            console.log('[requestToAI] Perplexity 응답 수신:', response);
        } else if (selectedAIModel === 'google') {
            console.log('[requestToAI] Google AI 브랜치 호출', { model: googleAIModel });
            response = await requestToGoogleAI(googleAIAPIKey, prompt, googleAIModel);
            console.log('[requestToAI] Google AI 응답 수신:', response);
        } else {
            console.error('[requestToAI] 유효하지 않은 AI 모델 선택:', selectedAIModel);
            throw new Error('유효하지 않은 AI 모델이 선택되었습니다.');
        }
        console.log('[requestToAI] 최종 응답 반환:', response);
        return response;
    } catch (error) {
        console.error('[requestToAI] catch 오류 발생:', error);
        console.error('AI 요청 중 오류 발생:', error);
        throw error;
    }
}

async function requestToOpenAI(apiKey: string, prompt: AIPrompt, model: string, enableWebSearch: boolean): Promise<string> {
    console.log('[requestToOpenAI] 함수 시작', { model, enableWebSearch, prompt: prompt.combinedPrompt });
    new Notice('OpenAI API 요청 시작');
    console.log('[requestToOpenAI] Notice 전송 완료');
    
    const url = 'https://api.openai.com/v1/responses';
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
    
    // Responses API 형식에 맞게 요청 데이터 구성
    const data: any = {
        model: model,
        input: prompt.combinedPrompt
    };
    console.log('[requestToOpenAI] 초기 payload:', data);

    if (prompt.max_tokens !== undefined) {
        data.max_output_tokens = prompt.max_tokens;
        console.log('[requestToOpenAI] max_output_tokens 설정:', data.max_output_tokens);
    }
    
    if (model.startsWith('o')) {
        data.reasoning = { effort: 'high' };
        new Notice(`${model} 모델\n최대 연산 능력(high) 적용됨`, 10000);
        console.log('[requestToOpenAI] reasoning 옵션 적용됨:', data.reasoning);
    }

    data.service_tier = 'auto';
    console.log('[requestToOpenAI] service_tier 설정:', data.service_tier);

    if (enableWebSearch && model === 'o4-mini') {
        data.tools = [{ 
            type: 'web_search',
            user_location: {
                type: "approximate",
                city: "Seoul",
                region: "Seoul",
                country: "KR",
                timezone: "Asia/Seoul"
            },
            search_context_size: "high"
        }];
        new Notice('웹 검색 도구 활성화됨 (서울 위치 기준)', 5000);
        console.log('[requestToOpenAI] tools 옵션 적용됨:', data.tools);
    }

    const params: RequestUrlParam = {
        url: url,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
    };
    console.log('[requestToOpenAI] 최종 요청 파라미터:', params);

    try {
        console.log('[requestToOpenAI] requestUrl 호출 시작');
        const response = await requestUrl(params);
        console.log('[requestToOpenAI] 응답 수신, status:', response.status, 'body:', response.json);
        if (response.status === 200) {
            // 응답 구조 분석하여 텍스트 추출
            let aiResponse = '';
            let usage = {
                prompt_tokens: response.json.usage?.input_tokens || 0,
                completion_tokens: response.json.usage?.output_tokens || 0,
                total_tokens: (response.json.usage?.input_tokens || 0) + (response.json.usage?.output_tokens || 0)
            };
            
            // 추론형 모델 (o-series) 응답 처리
            if (response.json.output && Array.isArray(response.json.output)) {
                // 추론형 모델은 보통 output[1]에 message 타입으로 응답을 반환
                const messageOutput = response.json.output.find((item: { type: string }) => item.type === 'message');
                if (messageOutput && messageOutput.content && Array.isArray(messageOutput.content) && messageOutput.content.length > 0) {
                    // message.content[0].text에서 응답 텍스트 추출
                    const textContent = messageOutput.content[0];
                    if (textContent.text) {
                        aiResponse = textContent.text.trim();
                        new Notice(`${model} 모델 응답 성공`, 3000);
                    }
                }
                
                // 메시지 출력을 찾지 못한 경우 다른 형식 시도
                if (!aiResponse && response.json.output.length > 0) {
                    // 다양한 응답 형식 처리 시도
                    for (const output of response.json.output) {
                        // 각 출력 항목의 content 배열을 확인
                        if (output.content && Array.isArray(output.content) && output.content.length > 0) {
                            for (const content of output.content) {
                                // text 속성이 있으면 바로 사용
                                if (content.text) {
                                    aiResponse = content.text.trim();
                                    break;
                                } else if (content.type === 'output_text' && content.text) {
                                    aiResponse = content.text.trim();
                                    break;
                                }
                            }
                        }
                        if (aiResponse) break;
                    }
                }
            }
            // 일반 모델이나 다른 형식의 응답 처리
            else if (response.json.output_text) {
                // 일부 모델은 최상위 레벨에 output_text 속성을 가질 수 있음
                aiResponse = response.json.output_text.trim();
            } else if (response.json.choices && response.json.choices.length > 0) {
                // Chat Completions API 스타일 응답 구조 처리 (하위 호환성)
                const choice = response.json.choices[0];
                if (choice.message && choice.message.content) {
                    aiResponse = choice.message.content.trim();
                }
            }
            
            if (!aiResponse) {
                // 응답 구조 상세 로깅
                console.error('응답 구조 상세:', JSON.stringify(response.json));
                new Notice('OpenAI API 응답 구조 오류: 텍스트를 추출할 수 없습니다');
                throw new Error('OpenAI API 응답 구조가 예상과 다릅니다.');
            }
            
            console.log('[requestToOpenAI] 파싱된 aiResponse:', aiResponse);
            
            return logAPIResponse('OpenAI', aiResponse, usage);
        } else {
            new Notice(`OpenAI API 오류 응답: ${response.status}`);
            const errorBody = JSON.parse(response.text);
            throw new Error(`OpenAI API 요청 실패: 상태 코드 ${response.status}, 오류 타입: ${errorBody.error?.type || '알 수 없음'}, 메시지: ${errorBody.error?.message || '알 수 없음'}`);
        }
    } catch (error) {
        console.error('[requestToOpenAI] catch 오류 발생:', error);
        new Notice('OpenAI API 요청 중 오류 발생');
        if (error instanceof Error) {
            if ('response' in error) {
                const responseError = error as any;
                const errorBody = JSON.parse(responseError.response.text);
                throw new Error(`OpenAI API 오류: 상태 코드 ${responseError.response.status}, 오류 타입: ${errorBody.error?.type || '알 수 없음'}, 메시지: ${errorBody.error?.message || '알 수 없음'}`);
            } else {
                throw new Error(`OpenAI API 오류: ${error.message}`);
            }
        } else {
            throw new Error('OpenAI API 요청 중 알 수 없는 오류 발생');
        }
    }
}

async function requestToClaude(apiKey: string, prompt: AIPrompt, model: string): Promise<string> {
    console.log('[requestToClaude] 함수 시작', { model, prompt: prompt.combinedPrompt });
    new Notice('Claude API 요청 시작');
    console.log('[requestToClaude] Notice 전송 완료');
    
    const requestOptions: any = {
        model: model,
        max_tokens: prompt.max_tokens || 4000,
        messages: [
            { role: "user", content: prompt.combinedPrompt }
        ]
    };
    console.log('[requestToClaude] requestOptions:', requestOptions);
    const anthropic = new Anthropic({ apiKey: apiKey, dangerouslyAllowBrowser: true });
    console.log('[requestToClaude] Anthropic client 초기화 완료');
    try {
        const response = await anthropic.messages.create(requestOptions);
        console.log('[requestToClaude] 응답 수신:', response);
        if (response.content && response.content.length > 0) {
            const content = response.content[0];
            if ('text' in content) {
                console.log('[requestToClaude] 파싱된 텍스트:', content.text);
                return logAPIResponse('Claude', content.text, response.usage);
            } else {
                new Notice('Claude API 응답 형식 오류');
                throw new Error('Claude API 응답의 내용 형식이 예상과 다릅니다.');
            }
        } else {
            new Notice('Claude API 빈 응답');
            throw new Error('Claude API 응답에 내용이 없습니다.');
        }
    } catch (error) {
        console.error('[requestToClaude] catch 오류 발생:', error);
        new Notice('Claude API 요청 중 예외 발생:', error);
        if (error instanceof Anthropic.APIError) {
            new Notice(`Claude API 오류: ${error.message}, 상태: ${error.status}, 유형: ${error.name}`);
            throw new Error(`Claude API 오류: ${error.message}, 상태: ${error.status}, 유형: ${error.name}`);
        } else if (error instanceof Error) {
            throw new Error(`Claude API 오류: ${error.message}`);
        } else {
            throw new Error('Claude API 요청 중 알 수 없는 오류 발생');
        }
    }
}

// Google AI (Gemini) 요청 함수 추가
async function requestToGoogleAI(apiKey: string, prompt: AIPrompt, model: string): Promise<string> {
    console.log('[requestToGoogleAI] 함수 시작', { model, prompt: prompt.combinedPrompt });
    new Notice('Google AI API 요청 시작');
    console.log('[requestToGoogleAI] Notice 전송 완료');
    
    const data = {
        contents: [{
            parts: [{ text: prompt.combinedPrompt }]
        }]
    };
    console.log('[requestToGoogleAI] 초기 data:', data);
    
    const params: RequestUrlParam = {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    };
    console.log('[requestToGoogleAI] 최종 params:', params);

    try {
        const response = await requestUrl(params);
        console.log('[requestToGoogleAI] 응답 수신, status:', response.status, 'body:', response.json);
        if (response.status === 200) {
            const candidates = response.json.candidates;
            if (candidates && candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
                const aiResponse = candidates[0].content.parts[0].text.trim();
                const usage = response.json.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
                const formattedUsage = {
                    prompt_tokens: usage.promptTokenCount,
                    completion_tokens: usage.candidatesTokenCount,
                    total_tokens: usage.totalTokenCount
                };
                console.log('[requestToGoogleAI] 파싱된 aiResponse:', aiResponse, 'usage:', formattedUsage);
                return logAPIResponse('Google AI', aiResponse, formattedUsage);
            } else {
                console.error('Google AI API 응답 형식 오류:', response.json);
                new Notice('Google AI API 응답 형식 오류');
                throw new Error('Google AI API 응답에서 콘텐츠를 추출할 수 없습니다.');
            }
        } else {
            console.error('Google AI API 오류 응답:', response);
            new Notice(`Google AI API 오류 응답: ${response.status}`);
            const errorBody = response.json?.error || { message: 'Unknown error' };
            throw new Error(`Google AI API 요청 실패: 상태 코드 ${response.status}, 메시지: ${errorBody.message}`);
        }
    } catch (error) {
        console.error('[requestToGoogleAI] catch 오류 발생:', error);
        console.error('Google AI API 요청 중 오류 발생:', error);
        if (error instanceof Error) {
            throw new Error(`Google AI API 오류: ${error.message}`);
        } else {
            throw new Error('Google AI API 요청 중 알 수 없는 오류 발생');
        }
    }
}

async function requestToPerplexity(apiKey: string, prompt: AIPrompt, model: string): Promise<string> {
    console.log('[requestToPerplexity] 함수 시작', { model, prompt: prompt.combinedPrompt });
    new Notice('Perplexity API 요청 시작');
    console.log('[requestToPerplexity] Notice 전송 완료');
    const url = 'https://api.perplexity.ai/chat/completions';
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const data = { model: model, messages: [{ role: 'user', content: prompt.combinedPrompt }] };
    console.log('[requestToPerplexity] request data:', data);

    const params: RequestUrlParam = { url: url, method: 'POST', headers: headers, body: JSON.stringify(data) };
    console.log('[requestToPerplexity] params:', params);

    try {
        const response = await requestUrl(params);
        console.log('[requestToPerplexity] 응답 수신, status:', response.status, 'body:', response.json);
        if (response.status === 200) {
            const aiResponse = response.json.choices[0].message.content.trim();
            console.log('[requestToPerplexity] 파싱된 aiResponse:', aiResponse);
            return logAPIResponse('Perplexity', aiResponse, response.json.usage);
        } else {
            new Notice('Perplexity API 오류 응답:', response.status);
            throw new Error(`Perplexity API 요청 실패: 상태 코드 ${response.status}`);
        }
    } catch (error) {
        console.error('[requestToPerplexity] catch 오류 발생:', error);
        new Notice('Perplexity API 요청 중 오류 발생:', error);
        if (error instanceof Error) {
            throw new Error(`Perplexity API 오류: ${error.message}`);
        } else {
            throw new Error('Perplexity API 요청 중 알 수 없는 오류 발생');
        }
    }
}
