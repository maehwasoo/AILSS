import { AILSSSettings } from '../../../core/settings/settings';
import { Notice } from 'obsidian';
import { requestToAI } from './aiUtils';
import AILSSPlugin from '../../../../main';

/**
 * 정확도 검증 결과 인터페이스
 */
export interface AccuracyResult {
    score: number;        // 0-100 범위의 정확도 점수
    feedback?: string;    // 선택적 피드백 텍스트
    success: boolean;     // 임계값 통과 여부
}

// 토큰 안전 제한 (다양한 AI 모델에 대응하기 위해 보수적으로 설정)
const MAX_SAFE_TOKENS = 12000; // 대부분의 AI 모델에서 안전하게 처리할 수 있는 토큰 수
const WARNING_TOKENS = 8000;   // 경고를 표시하기 시작할 토큰 수

/**
 * 텍스트의 토큰 수를 대략적으로 추정합니다.
 * 영어 기준으로 단어 당 약 1.3 토큰, 한글은 문자 당 약 1.5 토큰으로 계산합니다.
 */
export function estimateTokens(text: string): number {
    // 영어 단어 수 계산
    const englishWords = text.match(/[a-zA-Z]+/g)?.length || 0;
    
    // 한글 문자 수 계산
    const koreanChars = text.match(/[\uAC00-\uD7A3]/g)?.length || 0;
    
    // 숫자와 특수문자 수 계산
    const others = text.match(/[0-9\s\W]/g)?.length || 0;
    
    // 대략적인 토큰 수 계산
    return Math.ceil(englishWords * 1.3 + koreanChars * 1.5 + others * 0.5);
}

/**
 * 정확도 검증을 위한 프롬프트를 생성합니다
 */
function createAccuracyPrompt(originalText: string, userInput: string): string {
    return `
다음은 원본 텍스트와 사용자가 작성한 텍스트입니다. 원본 텍스트의 핵심 내용과 주요 키워드, 중요 포인트를 사용자가 얼마나 정확하게 기억하고 표현했는지 평가해주세요.

원본 텍스트:
"""
${originalText}
"""

사용자 입력:
"""
${userInput}
"""

평가 가이드라인:
1. 핵심 내용을 잘 포함하고 있는지 평가하세요. 문장이 정확히 일치하지 않아도 핵심 개념을 파악하고 있으면 높게 평가합니다.
2. 주요 키워드와 중요 포인트를 얼마나 정확히 기억하고 있는지 평가하세요.
3. 글자 하나하나 정확히 일치하는지는 중요하지 않습니다. 사용자가 자신의 말로 내용을 표현해도 괜찮습니다.
4. 사소한 세부사항이나 꾸밈말 누락은 감점 요소가 아닙니다.
5. 내용의 순서가 약간 다르더라도 핵심 내용이 포함되어 있다면 높게 평가합니다.
6. 수식이나 특수문자 등은 자연어로 표현되어 있으면 높게 평가합니다.

1. 0-100 사이의 점수로 정확도를 평가해주세요. 이 점수는 사용자가 원본 텍스트의 핵심 개념과 중요 내용을 얼마나 정확히 기억하고 표현했는지를 나타냅니다.
2. 간단한 피드백을 제공해주세요. 잘한 점과 놓친 핵심 내용이 있다면 언급해주세요.
3. 피드백 내용은 짧고 간결하게 작성해주세요.

응답 형식은 다음과 같이 JSON 형식으로 작성해주세요:
{
  "score": [0-100 사이의 정수],
  "feedback": "피드백 내용"
}
`;
}

/**
 * 노트 내용이 토큰 제한을 초과하는지 확인합니다.
 * @returns 안전: 0, 경고: 1, 위험: 2
 */
export function checkTokenLimit(originalText: string, userInput: string): { status: number; estimatedTokens: number } {
    const promptTokens = estimateTokens(createAccuracyPrompt('', '')); // 프롬프트 템플릿 자체의 토큰 수
    const originalTokens = estimateTokens(originalText);
    const userTokens = estimateTokens(userInput);
    
    const totalTokens = promptTokens + originalTokens + userTokens;
    
    if (totalTokens >= MAX_SAFE_TOKENS) {
        return { status: 2, estimatedTokens: totalTokens }; // 위험
    } else if (totalTokens >= WARNING_TOKENS) {
        return { status: 1, estimatedTokens: totalTokens }; // 경고
    } else {
        return { status: 0, estimatedTokens: totalTokens }; // 안전
    }
}

/**
 * AI를 사용하여 정확도를 검증합니다
 */
export async function checkAccuracy(
    originalText: string,
    userInput: string,
    settings: AILSSSettings,
    plugin?: AILSSPlugin
): Promise<AccuracyResult> {
    try {
        // 온라인 상태 확인
        if (!navigator.onLine) {
            new Notice('오프라인 상태입니다. 정확도 검증을 위해서는 인터넷 연결이 필요합니다.');
            throw new Error('오프라인 상태');
        }
        
        if (!plugin) {
            throw new Error('plugin 객체가 필요합니다');
        }
        
        // 토큰 제한 체크
        const tokenCheck = checkTokenLimit(originalText, userInput);
        if (tokenCheck.status === 2) {
            new Notice(`텍스트가 너무 깁니다\n약 ${tokenCheck.estimatedTokens} 토큰 감지됨\nAI 모델 토큰 한도를 초과할 수 있습니다`, 50000);
            return {
                success: false,
                score: 0,
                feedback: "텍스트가 너무 깁니다. AI 모델의 처리 한도를 초과합니다.\n핵심 내용만 복기해주세요."
            };
        } else if (tokenCheck.status === 1) {
            new Notice(`텍스트가 길어 정확도 평가가 부정확할 수 있습니다\n약 ${tokenCheck.estimatedTokens} 토큰 감지됨\n핵심 내용 위주로 평가합니다`, 50000);
        }
        
        // 프롬프트 생성
        const prompt = createAccuracyPrompt(originalText, userInput);
        
        // aiUtils의 requestToAI 함수 사용하여 API 호출
        const responseText = await requestToAI(plugin, {
            systemPrompt: '당신은 텍스트 정확도를 분석하는 AI 도우미입니다. 원본 텍스트와 사용자 입력의 내용적 유사성을 분석하여 정확도를 평가합니다.',
            userPrompt: prompt,
            temperature: 0.3
        });
        
        // JSON 파싱
        let resultJson;
        try {
            // 직접 JSON 파싱 시도
            resultJson = JSON.parse(responseText);
        } catch (e) {
            // JSON 형식을 찾아서 파싱
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('응답에서 JSON 형식을 찾을 수 없습니다.');
            }
            resultJson = JSON.parse(jsonMatch[0]);
        }
        
        // 점수 추출 및 범위 제한
        const score = Math.min(100, Math.max(0, resultJson.score));
        
        return {
            score,
            feedback: resultJson.feedback,
            success: score >= 75 // 75점 이상이면 성공
        };
    } catch (error) {
        console.error('정확도 검증 오류:', error);
        new Notice('정확도 검증 중 오류가 발생했습니다.');
        throw error;
    }
} 