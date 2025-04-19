import { App, TFile } from 'obsidian';
import { FrontmatterManager } from './frontmatterManager';
import { showTitleSearchModal } from '../../components/commonUI/titleSearchModal';

/**
 * 프론트매터 title 검색 관련 유틸리티
 */
export class FrontmatterSearchUtils {
    private static frontmatterManager = new FrontmatterManager();
    
    /**
     * 제목이나 별칭으로 노트 검색
     * @param app Obsidian App 인스턴스
     * @param searchText 검색할 텍스트
     * @param fuzzyMatch 퍼지 매치 여부 (true: 부분 일치, false: 정확히 일치)
     * @param maxResults 최대 결과 개수 (기본값 10)
     * @returns 검색결과 노트 배열
     */
    static async searchNotesByTitle(
        app: App, 
        searchText: string, 
        fuzzyMatch: boolean = true,
        maxResults: number = 10
    ): Promise<{file: TFile, title: string, matchType: 'title'|'alias'|'both'}[]> {
        // 검색어가 없으면 빈 배열 반환
        if (!searchText) {
            return [];
        }

        const results: {
            file: TFile,
            title: string,
            matchType: 'title'|'alias'|'both', 
            similarity: number
        }[] = [];

        // 검색어 정규화 (소문자 변환)
        const normalizedSearchText = searchText.toLowerCase();
        // 검색어를 단어 단위로 분리
        const searchWords = normalizedSearchText.split(/\s+/);

        // 모든 마크다운 파일 가져오기
        const files = app.vault.getMarkdownFiles();

        // 각 파일의 프론트매터 검사
        for (const file of files) {
            try {
                // 파일 내용 읽기
                const content = await app.vault.read(file);
                
                // 프론트매터 파싱
                const frontmatter = this.frontmatterManager.parseFrontmatter(content);
                if (!frontmatter) continue;

                // 제목 확인
                const title = frontmatter.title?.toString() || '';
                const normalizedTitle = title.toLowerCase();
                // 제목을 단어 단위로 분리
                const titleWords = normalizedTitle.split(/\s+/);
                
                // 별칭 확인
                const aliases = Array.isArray(frontmatter.aliases) ? 
                    frontmatter.aliases.map(a => a?.toString() || '') : [];
                
                let matchInTitle = false;
                let matchInAlias = false;
                let maxSimilarity = 0;
                
                // 제목 매칭 검사 (개선된 로직)
                if (fuzzyMatch) {
                    // 1. 전체 문자열 포함 관계 검사 (양방향)
                    if (normalizedTitle.includes(normalizedSearchText) || normalizedSearchText.includes(normalizedTitle)) {
                        matchInTitle = true;
                        maxSimilarity = this.calculateSimilarity(normalizedTitle, normalizedSearchText);
                    }
                    // 2. 단어 단위 매칭 - 제목 내 주요 단어들이 검색어에 포함되어 있는지
                    else {
                        const similarity = this.calculateWordSimilarity(titleWords, searchWords);
                        if (similarity > 0.4) { // 40% 이상의 단어가 매칭되면 유사하다고 판단
                            matchInTitle = true;
                            maxSimilarity = 0.2 + (similarity * 0.5); // 0.2 ~ 0.7 사이 점수
                        }
                    }
                } else {
                    // 정확한 일치만 검사
                    if (normalizedTitle === normalizedSearchText) {
                        matchInTitle = true;
                        maxSimilarity = 1.0;
                    }
                }

                // 별칭 매칭 검사 (기존 로직 활용하되, 단어 단위 매칭 추가)
                for (const alias of aliases) {
                    const normalizedAlias = alias.toLowerCase();
                    const aliasWords = normalizedAlias.split(/\s+/);
                    
                    if (fuzzyMatch) {
                        // 1. 전체 문자열 포함 관계 검사 (양방향)
                        if (normalizedAlias.includes(normalizedSearchText) || normalizedSearchText.includes(normalizedAlias)) {
                            matchInAlias = true;
                            const similarity = this.calculateSimilarity(normalizedAlias, normalizedSearchText);
                            if (similarity > maxSimilarity) {
                                maxSimilarity = similarity;
                            }
                        } 
                        // 2. 단어 단위 매칭
                        else {
                            const similarity = this.calculateWordSimilarity(aliasWords, searchWords);
                            if (similarity > 0.4) {
                                matchInAlias = true;
                                const aliasScore = 0.2 + (similarity * 0.5);
                                if (aliasScore > maxSimilarity) {
                                    maxSimilarity = aliasScore;
                                }
                            }
                        }
                    } else {
                        // 정확한 일치만 검사
                        if (normalizedAlias === normalizedSearchText) {
                            matchInAlias = true;
                            maxSimilarity = 1.0;
                            break;
                        }
                    }
                }

                // 매칭된 경우 결과에 추가
                if (matchInTitle || matchInAlias) {
                    let matchType: 'title'|'alias'|'both' = 'title';
                    if (matchInTitle && matchInAlias) {
                        matchType = 'both';
                    } else if (matchInAlias) {
                        matchType = 'alias';
                    }
                    
                    results.push({
                        file,
                        title,
                        matchType,
                        similarity: maxSimilarity
                    });
                }
            } catch (error) {
                console.error(`노트 검색 중 오류: ${file.path}`, error);
            }
        }
        
        // 유사도에 따라 내림차순 정렬 후 최대 결과 개수만큼 반환
        return results
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, maxResults)
            .map(({ file, title, matchType }) => ({ file, title, matchType }));
    }
    
    /**
     * 두 문자열 간의 유사도 계산 (Jaro-Winkler 거리 변형)
     * 값이 높을수록 더 유사함
     */
    private static calculateSimilarity(str1: string, str2: string): number {
        // 완전 일치는 최대 유사도
        if (str1 === str2) return 1.0;
        
        // 포함 관계 가중치 (양방향)
        if (str1.includes(str2)) {
            // 더 짧을수록 더 정확한 일치로 간주
            const ratio = str2.length / str1.length;
            return 0.7 + (ratio * 0.3); // 0.7 ~ 1.0 사이의 값
        }
        
        if (str2.includes(str1)) {
            // 반대 방향도 고려 (검색어가 더 길고 노트 제목을 포함할 경우)
            const ratio = str1.length / str2.length;
            return 0.6 + (ratio * 0.3); // 0.6 ~ 0.9 사이의 값 (약간 낮게 설정)
        }
        
        // 단어 단위 부분 매칭 (모든 단어가 일치할 수록 높은 점수)
        const words1 = str1.split(/\s+/);
        const words2 = str2.split(/\s+/);
        
        return this.calculateWordSimilarity(words1, words2) * 0.7; // 최대 0.7의 유사도
    }
    
    /**
     * 두 단어 집합 간의 유사도 계산
     * @param words1 첫 번째 단어 배열
     * @param words2 두 번째 단어 배열
     * @returns 0~1 사이의 유사도 점수
     */
    private static calculateWordSimilarity(words1: string[], words2: string[]): number {
        if (words1.length === 0 || words2.length === 0) return 0;
        
        // 각 단어별로 매칭 여부 확인
        let matchCount = 0;
        let partialMatchScore = 0;
        
        // 1. 정확한 단어 매칭
        for (const word1 of words1) {
            // 완전 일치 단어 찾기
            if (words2.includes(word1)) {
                matchCount++;
                continue;
            }
            
            // 부분 일치 단어 찾기 (양방향)
            let bestPartialMatch = 0;
            for (const word2 of words2) {
                if (word1.includes(word2)) {
                    // 검색어의 단어가 제목 단어에 포함됨
                    const score = word2.length / word1.length; 
                    bestPartialMatch = Math.max(bestPartialMatch, score * 0.8);
                }
                else if (word2.includes(word1)) {
                    // 제목의 단어가 검색어 단어에 포함됨
                    const score = word1.length / word2.length;
                    bestPartialMatch = Math.max(bestPartialMatch, score * 0.8);
                }
                else if (this.hasCommonSubstring(word1, word2, 2)) {
                    // 공통 부분 문자열이 있는 경우 (오타 감안)
                    bestPartialMatch = Math.max(bestPartialMatch, 0.4);
                }
            }
            
            partialMatchScore += bestPartialMatch;
        }
        
        // 2. 합산 점수 계산 (완전 일치와 부분 일치의 가중 평균)
        const totalScore = matchCount + (partialMatchScore * 0.5);
        
        // 양쪽의 단어 수를 고려하여 유사도 계산
        // 검색어의 단어 중 몇 개가 매칭되는지가 더 중요함
        const searchWordsCount = words2.length;
        const titleWordsCount = words1.length;
        
        // 단어 매칭 비율 계산 (검색어 단어 비중을 더 높게)
        const searchMatchRatio = totalScore / Math.max(searchWordsCount, 1);
        const titleMatchRatio = totalScore / Math.max(titleWordsCount, 1);
        
        // 검색어 매칭 비율과 제목 매칭 비율을 가중 평균 (검색어 매칭에 더 높은 가중치)
        return (searchMatchRatio * 0.7) + (titleMatchRatio * 0.3);
    }
    
    /**
     * 두 문자열 간에 지정한 길이 이상의 공통 부분 문자열이 있는지 확인
     */
    private static hasCommonSubstring(str1: string, str2: string, minLength: number): boolean {
        for (let i = 0; i <= str1.length - minLength; i++) {
            const substr = str1.substring(i, i + minLength);
            if (str2.includes(substr)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 제목으로 노트 검색 후 모달 표시 (중복 노트 검색 및 사용자 선택 처리)
     * @param app Obsidian App 인스턴스
     * @param searchText 검색할 텍스트 (노트 제목)
     * @param customMessage 사용자 정의 메시지 (기본값 제공)
     * @returns 모달 결과 {action, selectedFile} 또는 null (검색결과 없을 경우)
     */
    static async searchAndShowModal(
        app: App,
        searchText: string,
        customMessage?: string
    ): Promise<{action: 'select'|'create'|'cancel', selectedFile?: TFile} | null> {
        // 1. 유사한 노트 검색
        const searchResults = await this.searchNotesByTitle(app, searchText);

        // 2. 검색 결과가 있으면 확인 모달 표시
        if (searchResults.length > 0) {
            const message = customMessage || 
                `"${searchText}"와 유사한 제목의 노트가 발견되었습니다.\n새 노트를 생성하시겠습니까?`;

            const modalResult = await showTitleSearchModal(app, {
                title: "유사한 노트 발견",
                message: message,
                searchResults
            });

            return modalResult;
        }

        // 검색 결과가 없으면 null 반환 (새 노트 생성 진행)
        return null;
    }
}