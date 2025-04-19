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

/**
 * 정확도 검증을 위한 프롬프트를 생성합니다
 */
function createAccuracyPrompt(originalText: string, userInput: string): string {
    return `
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