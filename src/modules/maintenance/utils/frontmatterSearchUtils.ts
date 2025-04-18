import { App, TFile } from 'obsidian';
import { FrontmatterManager } from './frontmatterManager';

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
                
                // 별칭 확인
                const aliases = Array.isArray(frontmatter.aliases) ? 
                    frontmatter.aliases.map(a => a?.toString() || '') : [];
                
                let matchInTitle = false;
                let matchInAlias = false;
                let maxSimilarity = 0;
                
                // 제목 매칭 검사
                if (
                    (fuzzyMatch && normalizedTitle.includes(normalizedSearchText)) || 
                    (!fuzzyMatch && normalizedTitle === normalizedSearchText)
                ) {
                    matchInTitle = true;
                    maxSimilarity = this.calculateSimilarity(normalizedTitle, normalizedSearchText);
                }

                // 별칭 매칭 검사
                for (const alias of aliases) {
                    const normalizedAlias = alias.toLowerCase();
                    if (
                        (fuzzyMatch && normalizedAlias.includes(normalizedSearchText)) ||
                        (!fuzzyMatch && normalizedAlias === normalizedSearchText)
                    ) {
                        matchInAlias = true;
                        const similarity = this.calculateSimilarity(normalizedAlias, normalizedSearchText);
                        if (similarity > maxSimilarity) {
                            maxSimilarity = similarity;
                        }
                        break; // 하나의 별칭에서라도 매칭되면 중단
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
        
        // 포함 관계 가중치
        if (str1.includes(str2)) {
            // 더 짧을수록 더 정확한 일치로 간주
            const ratio = str2.length / str1.length;
            return 0.7 + (ratio * 0.3); // 0.7 ~ 1.0 사이의 값
        }
        
        // 단어 단위 부분 매칭 (모든 단어가 일치할 수록 높은 점수)
        const words1 = str1.split(/\s+/);
        const words2 = str2.split(/\s+/);
        
        // 매칭되는 단어 수 카운트
        let matchCount = 0;
        for (const word1 of words1) {
            if (words2.some(w => w === word1 || w.includes(word1) || word1.includes(w))) {
                matchCount++;
            }
        }
        
        // 매칭된 단어 비율 계산
        const matchRatio = matchCount / Math.max(words1.length, 1);
        return 0.2 + (matchRatio * 0.5); // 0.2 ~ 0.7 사이의 값
    }
}