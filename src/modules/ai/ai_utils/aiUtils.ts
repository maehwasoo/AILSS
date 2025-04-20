import { requestUrl, RequestUrlParam, Notice } from 'obsidian';
import AILSSPlugin from '../../../../main';
import Anthropic from '@anthropic-ai/sdk';

interface AIPrompt {
    systemPrompt?: string;  // 선택적 필드(각 모듈에서 userPrompt에 이미 포함됨)
    userPrompt: string;     // 실제로 사용되는 프롬프트
    temperature?: number;   // 선택적 필드
    max_tokens?: number;    // 선택적 필드
}

function logAPIRequest(provider: string, prompt: AIPrompt) {
    //console.log(`=== ${provider} 요청 정보 ===`);
    //console.log('시스템 프롬프트:', prompt.systemPrompt);
    //console.log('사용자 프롬프트:', prompt.userPrompt);
    //console.log('온도:', prompt.temperature);
    //console.log('최대 토큰:', prompt.max_tokens);
    //console.log('=====================');
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

    //console.log(`=== ${provider} 응답 정보 ===`);
    //console.log('응답:', response);
    //console.log('토큰 사용량:', usageInfo);
    //console.log('=====================');

    new Notice(usageMessage, 5000);

    return response;
}

export async function requestToAI(plugin: AILSSPlugin, prompt: AIPrompt): Promise<string> {
    const { selectedAIModel, openAIModel, claudeModel, perplexityModel, googleAIModel, googleAIAPIKey, enableWebSearch } = plugin.settings; // enableWebSearch 추가
    
    // 모델 이름 결정 로직 수정
    const modelName = selectedAIModel === 'openai' ? openAIModel :
                    selectedAIModel === 'claude' ? claudeModel :
                    selectedAIModel === 'perplexity' ? perplexityModel :
                    selectedAIModel === 'google' ? googleAIModel : 'Unknown Model';
    
    // 사용자에게 보여줄 초기 메시지
    const userMessage = `🤖 AI 요청 정보:\n` +
                       `서비스: ${selectedAIModel.toUpperCase()}\n` +
                       `모델: ${modelName}\n` +
                       `처리 중...`;
    
    // Notice로 통일
    new Notice(userMessage, 5000);

    // 시스템 프롬프트를 유저 프롬프트에 통합
    const combinedPrompt = {
        ...prompt,
        userPrompt: prompt.systemPrompt ? `${prompt.systemPrompt}\n\n${prompt.userPrompt}` : prompt.userPrompt
    };

    try {
        let response = '';
        if (selectedAIModel === 'openai') {
            response = await requestToOpenAI(plugin.settings.openAIAPIKey, combinedPrompt, openAIModel, enableWebSearch); // enableWebSearch 파라미터 추가
        } else if (selectedAIModel === 'claude') {
            response = await requestToClaude(plugin.settings.claudeAPIKey, combinedPrompt, claudeModel);
        } else if (selectedAIModel === 'perplexity') {
            response = await requestToPerplexity(plugin.settings.perplexityAPIKey, combinedPrompt, perplexityModel);
        } else if (selectedAIModel === 'google') {
            response = await requestToGoogleAI(googleAIAPIKey, combinedPrompt, googleAIModel);
        } else {
            throw new Error('유효하지 않은 AI 모델이 선택되었습니다.');
        }
        return response;
    } catch (error) {
        console.error('AI 요청 중 오류 발생:', error);
        throw error;
    }
}

async function requestToOpenAI(apiKey: string, prompt: AIPrompt, model: string, enableWebSearch: boolean): Promise<string> { // enableWebSearch 파라미터 추가
    new Notice('OpenAI API 요청 시작');
    
    const url = 'https://api.openai.com/v1/responses';
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
    
    // Responses API 형식에 맞게 요청 데이터 구성
    const data: any = {
        model: model,
        input: prompt.userPrompt,
        stream: false // 응답 스트리밍 활성화
    };

    // 추가 옵션 설정 (필요한 경우)
    if (prompt.temperature !== undefined) {
        data.temperature = prompt.temperature;
    } else {
        // 기본값 설정 (temperature는 기본값이 1)
        data.temperature = 1;
    }

    if (prompt.max_tokens !== undefined) {
        data.max_output_tokens = prompt.max_tokens;
    }
    
    // o4-mini, o3 등 reasoning 모델에 reasoning_effort 추가
    if (model === 'o4-mini' || model === 'o3' || model === 'o1-pro') {
        data.reasoning = { effort: 'high' };
        new Notice(`${model} 모델\n최대 연산 능력(high) 적용됨`, 10000);
    }

    // 서비스 티어 설정 (기본값은 'auto')
    data.service_tier = 'auto';

    // enableWebSearch 옵션에 따라 웹 검색 도구 활성화
    if (enableWebSearch) {
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
    }

    const params: RequestUrlParam = {
        url: url,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
    };

    try {
        const response = await requestUrl(params);
        if (response.status === 200) {
            console.log('OpenAI 응답 구조:', response.json);
            
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
            
            return logAPIResponse('OpenAI', aiResponse, usage);
        } else {
            new Notice(`OpenAI API 오류 응답: ${response.status}`);
            const errorBody = JSON.parse(response.text);
            throw new Error(`OpenAI API 요청 실패: 상태 코드 ${response.status}, 오류 타입: ${errorBody.error?.type || '알 수 없음'}, 메시지: ${errorBody.error?.message || '알 수 없음'}`);
        }
    } catch (error) {
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
    //logAPIRequest('Claude', prompt);
    //console.log('Claude 요청 정보:', {
    //    systemPrompt: prompt.systemPrompt,
    //    userPrompt: prompt.userPrompt,
    //    temperature: prompt.temperature,
    //    max_tokens: prompt.max_tokens
    //});
    
    const anthropic = new Anthropic({
        apiKey: apiKey,
        dangerouslyAllowBrowser: true
    });

    try {
        //console.log('Claude API 요청 시작');
        new Notice('Claude API 요청 시작');
        
        // API 요청 객체 생성
        const requestOptions: any = {
            model: model,
            // 기본값 설정 (Claude API에서 max_tokens는 필수임)
            max_tokens: prompt.max_tokens || 2000,
            messages: [
                // 참고: systemPrompt 필드는 무시하고 userPrompt만 사용 (이미 포함됨)
                { role: "user", content: prompt.userPrompt }
            ],
        };
        
        // temperature 파라미터 추가 (선택적)
        if (prompt.temperature !== undefined) {
            requestOptions.temperature = prompt.temperature;
        }
        
        const response = await anthropic.messages.create(requestOptions);
        
        if (response.content && response.content.length > 0) {
            const content = response.content[0];
            if ('text' in content) {
                return logAPIResponse('Claude', content.text, response.usage);
            } else {
                //console.error('Claude API 응답 형식 오류:', response);
                new Notice('Claude API 응답 형식 오류');
                throw new Error('Claude API 응답의 내용 형식이 예상과 다릅니다.');
            }
        } else {
            //console.error('Claude API 빈 응답:', response);
            new Notice('Claude API 빈 응답');
            throw new Error('Claude API 응답에 내용이 없습니다.');
        }
    } catch (error) {
        //console.error('Claude API 요청 중 예외 발생:', error);
        new Notice('Claude API 요청 중 예외 발생:', error);
        if (error instanceof Anthropic.APIError) {
            //console.error('Claude API 오류 상세:', {
            //    status: error.status,
            //    message: error.message,
            //    name: error.name
            //});
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
    new Notice('Google AI API 요청 시작');
    // Gemini API 엔드포인트 (v1beta 사용 예시, 모델에 따라 다를 수 있음)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const headers = {
        'Content-Type': 'application/json'
    };

    // Google AI API 요청 형식에 맞게 데이터 구성
    const data = {
        contents: [{
            parts: [{
                text: prompt.userPrompt // Gemini는 'text' 필드를 사용
            }]
        }],
        // generationConfig: { // 필요한 경우 온도 등 설정 추가
        //     temperature: prompt.temperature,
        //     maxOutputTokens: prompt.max_tokens
        // }
    };

    const params: RequestUrlParam = {
        url: url,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
    };

    try {
        const response = await requestUrl(params);
        if (response.status === 200) {
            // 응답 구조 확인 및 텍스트 추출 (Gemini API 응답 구조에 따라 조정 필요)
            const candidates = response.json.candidates;
            if (candidates && candidates.length > 0 && candidates[0].content && candidates[0].content.parts && candidates[0].content.parts.length > 0) {
                const aiResponse = candidates[0].content.parts[0].text.trim();
                // Google AI API는 현재(2024년 기준) 응답에 토큰 사용량 정보를 포함하지 않을 수 있음.
                // 포함될 경우 response.json.usageMetadata 등을 확인하여 파싱 필요.
                const usage = response.json.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
                // logAPIResponse 함수 형식에 맞게 변환
                const formattedUsage = {
                    prompt_tokens: usage.promptTokenCount,
                    completion_tokens: usage.candidatesTokenCount,
                    total_tokens: usage.totalTokenCount
                };
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
        console.error('Google AI API 요청 중 오류 발생:', error);
        new Notice('Google AI API 요청 중 오류 발생');
        if (error instanceof Error) {
            throw new Error(`Google AI API 오류: ${error.message}`);
        } else {
            throw new Error('Google AI API 요청 중 알 수 없는 오류 발생');
        }
    }
}


async function requestToPerplexity(apiKey: string, prompt: AIPrompt, model: string): Promise<string> {
    //logAPIRequest('Perplexity', prompt);
    //console.log('Perplexity 요청 정보:', {
    //    systemPrompt: prompt.systemPrompt,
    //    userPrompt: prompt.userPrompt,
    //    temperature: prompt.temperature,
    //    max_tokens: prompt.max_tokens
    //});

    new Notice('Perplexity API 요청 시작');
    const url = 'https://api.perplexity.ai/chat/completions';
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
    const data = {
        model: model,
        messages: [
            { role: 'user', content: prompt.userPrompt }
        ]
    };

    const params: RequestUrlParam = {
        url: url,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
    };

    try {
        const response = await requestUrl(params);
        if (response.status === 200) {
            const aiResponse = response.json.choices[0].message.content.trim();
            return logAPIResponse('Perplexity', aiResponse, response.json.usage);
        } else {
            //console.error('Perplexity API 오류 응답:', response);
            new Notice('Perplexity API 오류 응답:', response.status);
            throw new Error(`Perplexity API 요청 실패: 상태 코드 ${response.status}`);
        }
    } catch (error) {
        //console.error('Perplexity API 요청 중 오류 발생:', error);
        new Notice('Perplexity API 요청 중 오류 발생:', error);
        if (error instanceof Error) {
            throw new Error(`Perplexity API 오류: ${error.message}`);
        } else {
            throw new Error('Perplexity API 요청 중 알 수 없는 오류 발생');
        }
    }
}
