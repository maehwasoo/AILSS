import { AILSSSettings } from '../../../core/settings/settings';
import { Notice } from 'obsidian';

/**
 * 정확도 검증 결과 인터페이스
 */
export interface AccuracyResult {
    score: number;        // 0-100 범위의 정확도 점수
    feedback?: string;    // 선택적 피드백 텍스트
    success: boolean;     // 임계값 통과 여부
}

/**
 * OpenAI API를 사용하여 정확도 검증 수행
 */
async function checkAccuracyWithOpenAI(
    originalText: string,
    userInput: string,
    apiKey: string,
    modelName: string
): Promise<AccuracyResult> {
    try {
        // API 요청 준비
        const prompt = `
다음은 원본 텍스트와 사용자가 작성한 텍스트입니다. 원본 텍스트 내용을 사용자가 얼마나 정확하게 기억하고 표현했는지 평가해주세요.

원본 텍스트:
"""
${originalText}
"""

사용자 입력:
"""
${userInput}
"""

1. 0-100 사이의 점수로 정확도를 평가해주세요. 이 점수는 사용자가 원본 텍스트의 핵심 개념과 중요 내용을 얼마나 정확히 기억하고 표현했는지를 나타냅니다.
2. 간단한 피드백을 제공해주세요.

응답 형식은 다음과 같이 JSON 형식으로 작성해주세요:
{
  "score": [0-100 사이의 정수],
  "feedback": "피드백 내용"
}
`;

        // API 요청
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    {
                        role: 'system',
                        content: '당신은 텍스트 정확도를 분석하는 AI 도우미입니다. 원본 텍스트와 사용자 입력의 내용적 유사성을 분석하여 정확도를 평가합니다.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                response_format: { type: 'json_object' }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`OpenAI API 오류: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const resultText = data.choices[0].message.content;
        
        // JSON 파싱
        const resultJson = JSON.parse(resultText);
        const score = Math.min(100, Math.max(0, resultJson.score)); // 0-100 범위로 제한
        
        return {
            score,
            feedback: resultJson.feedback,
            success: score >= 75 // 75점 이상이면 성공
        };
    } catch (error) {
        console.error('OpenAI 정확도 검증 오류:', error);
        throw error;
    }
}

/**
 * Claude API를 사용하여 정확도 검증 수행
 */
async function checkAccuracyWithClaude(
    originalText: string,
    userInput: string,
    apiKey: string,
    modelName: string
): Promise<AccuracyResult> {
    try {
        // API 요청 준비
        const prompt = `
다음은 원본 텍스트와 사용자가 작성한 텍스트입니다. 원본 텍스트 내용을 사용자가 얼마나 정확하게 기억하고 표현했는지 평가해주세요.

원본 텍스트:
"""
${originalText}
"""

사용자 입력:
"""
${userInput}
"""

1. 0-100 사이의 점수로 정확도를 평가해주세요. 이 점수는 사용자가 원본 텍스트의 핵심 개념과 중요 내용을 얼마나 정확히 기억하고 표현했는지를 나타냅니다.
2. 간단한 피드백을 제공해주세요.

응답 형식은 다음과 같이 JSON 형식으로 작성해주세요:
{
  "score": [0-100 사이의 정수],
  "feedback": "피드백 내용"
}
`;

        // API 요청
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: modelName,
                system: "당신은 텍스트 정확도를 분석하는 AI 도우미입니다. 원본 텍스트와 사용자 입력의 내용적 유사성을 분석하여 정확도를 평가합니다.",
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Claude API 오류: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const resultText = data.content?.[0]?.text;
        
        // JSON 파싱
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('응답에서 JSON 형식을 찾을 수 없습니다.');
        }
        
        const resultJson = JSON.parse(jsonMatch[0]);
        const score = Math.min(100, Math.max(0, resultJson.score)); // 0-100 범위로 제한
        
        return {
            score,
            feedback: resultJson.feedback,
            success: score >= 75 // 75점 이상이면 성공
        };
    } catch (error) {
        console.error('Claude 정확도 검증 오류:', error);
        throw error;
    }
}

/**
 * Perplexity API를 사용하여 정확도 검증 수행
 */
async function checkAccuracyWithPerplexity(
    originalText: string,
    userInput: string,
    apiKey: string,
    modelName: string
): Promise<AccuracyResult> {
    try {
        // API 요청 준비
        const prompt = `
다음은 원본 텍스트와 사용자가 작성한 텍스트입니다. 원본 텍스트 내용을 사용자가 얼마나 정확하게 기억하고 표현했는지 평가해주세요.

원본 텍스트:
"""
${originalText}
"""

사용자 입력:
"""
${userInput}
"""

1. 0-100 사이의 점수로 정확도를 평가해주세요. 이 점수는 사용자가 원본 텍스트의 핵심 개념과 중요 내용을 얼마나 정확히 기억하고 표현했는지를 나타냅니다.
2. 간단한 피드백을 제공해주세요.

응답 형식은 다음과 같이 JSON 형식으로 작성해주세요:
{
  "score": [0-100 사이의 정수],
  "feedback": "피드백 내용"
}
`;

        // API 요청
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    {
                        role: 'system',
                        content: '당신은 텍스트 정확도를 분석하는 AI 도우미입니다. 원본 텍스트와 사용자 입력의 내용적 유사성을 분석하여 정확도를 평가합니다.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Perplexity API 오류: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const resultText = data.choices[0].message.content;
        
        // JSON 파싱
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('응답에서 JSON 형식을 찾을 수 없습니다.');
        }
        
        const resultJson = JSON.parse(jsonMatch[0]);
        const score = Math.min(100, Math.max(0, resultJson.score)); // 0-100 범위로 제한
        
        return {
            score,
            feedback: resultJson.feedback,
            success: score >= 75 // 75점 이상이면 성공
        };
    } catch (error) {
        console.error('Perplexity 정확도 검증 오류:', error);
        throw error;
    }
}

/**
 * Google AI를 사용하여 정확도 검증 수행
 */
async function checkAccuracyWithGoogle(
    originalText: string,
    userInput: string,
    apiKey: string,
    modelName: string
): Promise<AccuracyResult> {
    try {
        // API 요청 준비
        const prompt = `
다음은 원본 텍스트와 사용자가 작성한 텍스트입니다. 원본 텍스트 내용을 사용자가 얼마나 정확하게 기억하고 표현했는지 평가해주세요.

원본 텍스트:
"""
${originalText}
"""

사용자 입력:
"""
${userInput}
"""

1. 0-100 사이의 점수로 정확도를 평가해주세요. 이 점수는 사용자가 원본 텍스트의 핵심 개념과 중요 내용을 얼마나 정확히 기억하고 표현했는지를 나타냅니다.
2. 간단한 피드백을 제공해주세요.

응답 형식은 다음과 같이 JSON 형식으로 작성해주세요:
{
  "score": [0-100 사이의 정수],
  "feedback": "피드백 내용"
}
`;

        // API 요청 - Gemini API 엔드포인트 사용
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                text: prompt
                            }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.3,
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Google AI API 오류: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const resultText = data.candidates[0].content.parts[0].text;
        
        // JSON 파싱
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('응답에서 JSON 형식을 찾을 수 없습니다.');
        }
        
        const resultJson = JSON.parse(jsonMatch[0]);
        const score = Math.min(100, Math.max(0, resultJson.score)); // 0-100 범위로 제한
        
        return {
            score,
            feedback: resultJson.feedback,
            success: score >= 75 // 75점 이상이면 성공
        };
    } catch (error) {
        console.error('Google AI 정확도 검증 오류:', error);
        throw error;
    }
}

/**
 * 설정에 따라 적절한 AI 모델을 선택하여 정확도 검증 수행
 */
export async function checkAccuracy(
    originalText: string,
    userInput: string,
    settings: AILSSSettings
): Promise<AccuracyResult> {
    try {
        // 온라인 상태 확인
        if (!navigator.onLine) {
            new Notice('오프라인 상태입니다. 정확도 검증을 위해서는 인터넷 연결이 필요합니다.');
            throw new Error('오프라인 상태');
        }
        
        // 선택된 AI 모델에 따라 적절한 API 호출
        const selectedModel = settings.selectedAIModel;
        
        switch(selectedModel) {
            case 'openai':
                return await checkAccuracyWithOpenAI(
                    originalText, 
                    userInput, 
                    settings.openAIAPIKey, 
                    settings.openAIModel
                );
            case 'claude':
                return await checkAccuracyWithClaude(
                    originalText, 
                    userInput, 
                    settings.claudeAPIKey, 
                    settings.claudeModel
                );
            case 'perplexity':
                return await checkAccuracyWithPerplexity(
                    originalText, 
                    userInput, 
                    settings.perplexityAPIKey, 
                    settings.perplexityModel
                );
            case 'google':
                return await checkAccuracyWithGoogle(
                    originalText, 
                    userInput, 
                    settings.googleAIAPIKey, 
                    settings.googleAIModel
                );
            default:
                throw new Error(`지원되지 않는 AI 모델: ${selectedModel}`);
        }
    } catch (error) {
        console.error('정확도 검증 오류:', error);
        new Notice('정확도 검증 중 오류가 발생했습니다.');
        throw error;
    }
} 