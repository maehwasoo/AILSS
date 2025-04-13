import { App, Notice, MarkdownView, moment } from 'obsidian';
import type AILSSPlugin from '../../../../main';
import { FrontmatterManager } from '../../maintenance/utils/frontmatterManager';
import { PathSettings } from '../../maintenance/settings/pathSettings';
import { requestToAI } from '../ai_utils/aiUtils';
import { getContentWithoutFrontmatter } from '../../maintenance/utils/contentUtils';

export class AILinkNote {
    constructor(
        private app: App,
        private plugin: AILSSPlugin
    ) {}

    async createAILinkNote() {
        try {
            // 노트 개수 제한 확인
            if (!(await PathSettings.checkNoteLimit(this.app, this.plugin))) {
                new Notice(`노트 개수가 최대 제한(${PathSettings.MAX_NOTES}개)에 도달했습니다.`);
                return;
            }
            // 현재 활성화된 에디터와 선택된 텍스트 가져오기
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView) {
                throw new Error("활성화된 마크다운 뷰가 없습니다.");
            }

            const editor = activeView.editor;
            const selectedText = editor.getSelection().trim();
            
            // 현재 선택된 텍스트의 정확한 위치 가져오기
            const currentSelection = {
                from: editor.getCursor('from'),
                to: editor.getCursor('to')
            };
            
            if (!selectedText) {
                throw new Error("선택된 텍스트가 없습니다.");
            }

            // 현재 문서의 전체 내용 가져오기
            const currentContent = editor.getValue();
            
            // 선택한 텍스트의 위치 정보 저장
            const selectionStartPos = editor.posToOffset(currentSelection.from);
            const selectionEndPos = editor.posToOffset(currentSelection.to);
            
            // 선택 해제
            editor.setSelection(currentSelection.to, currentSelection.to);

            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                throw new Error("현재 열린 파일을 찾을 수 없습니다.");
            }

            // 현재 노트의 전체 내용과 frontmatter 가져오기
            const fileContent = await this.app.vault.read(activeFile);
            const frontmatterManager = new FrontmatterManager();
            const currentFrontmatter = frontmatterManager.parseFrontmatter(fileContent);

            // AI 분석 요청
            new Notice("AI 분석 중...");
            const { content: aiContent, jsonData } = await this.generateAIContent(fileContent, selectedText);

            // 새로운 태그 설정
            let tags: string[] = [];
            if (jsonData && jsonData.tags && Array.isArray(jsonData.tags)) {
                tags = jsonData.tags;
            }

            // 새로운 별칭 설정
            let aliases: string[] = [];
            if (jsonData && jsonData.aliases && Array.isArray(jsonData.aliases)) {
                aliases = jsonData.aliases;
            }

            // 노트 생성
            const { file, fileName: newFileName, timestamp } = await PathSettings.createNote({
                app: this.app,
                frontmatterConfig: {
                    title: selectedText,
                    tags: tags,
                    aliases: aliases
                },
                content: aiContent,
                isInherited: true
            });

            // 설정에 따라 링크 삽입 처리
            if (this.plugin.settings.convertSelectionToLink) {
                // 노트 생성 후 텍스트 내용 기반으로 위치를 찾아 링크 삽입
                const fileNameWithoutExtension = newFileName.replace(PathSettings.DEFAULT_FILE_EXTENSION, '');
                const linkText = `[[${fileNameWithoutExtension}|${selectedText}]]`;
                
                // 텍스트 검색 및 대체 (원래 선택했던 위치 정보 활용)
                if (this.replaceSelectedText(editor, selectedText, linkText, selectionStartPos)) {
                    new Notice(`AI 분석이 포함된 새 노트가 생성되었습니다: ${file.path}`);
                } else {
                    new Notice(`노트는 생성되었지만 링크 삽입에 실패했습니다. 수동으로 링크를 삽입해주세요: ${file.path}`);
                }
            } else {
                // 링크로 변환하지 않고 노트만 생성
                new Notice(`AI 분석이 포함된 새 노트가 생성되었습니다: ${file.path}`);
            }
            
            return file;
        } catch (error) {
            new Notice('노트 생성 중 오류가 발생했습니다.');
            console.error('Error creating AI note:', error);
            throw error;
        }
    }

    /**
     * 에디터에서 텍스트를 찾아 링크로 대체하는 함수
     * @param editor 에디터 인스턴스
     * @param searchText 찾을 텍스트
     * @param replaceText 대체할 텍스트
     * @param originalPosition 원래 선택했던 텍스트의 시작 위치
     * @returns 성공 여부
     */
    private replaceSelectedText(editor: any, searchText: string, replaceText: string, originalPosition: number): boolean {
        const content = editor.getValue();
        
        // 1. 정확한 위치 검색: 원래 선택했던 위치 주변에서 텍스트 검색
        const searchRadius = 100; // 원래 위치에서 앞뒤로 탐색할 문자 수
        const startPos = Math.max(0, originalPosition - searchRadius);
        const endPos = Math.min(content.length, originalPosition + searchText.length + searchRadius);
        
        const nearbyContent = content.substring(startPos, endPos);
        const relativePos = nearbyContent.indexOf(searchText);
        
        if (relativePos >= 0) {
            const exactPos = startPos + relativePos;
            const fromPos = editor.offsetToPos(exactPos);
            const toPos = editor.offsetToPos(exactPos + searchText.length);
            
            editor.setSelection(fromPos, toPos);
            editor.replaceSelection(replaceText);
            return true;
        }
        
        // 2. 정확한 위치에서 찾지 못한 경우, 전체 문서에서 검색
        // 현재 커서 위치
        const cursor = editor.getCursor();
        const cursorPos = editor.posToOffset(cursor);
        
        // 원래 위치에 가장 가까운 일치하는 텍스트 찾기
        const allMatches = this.findAllOccurrences(content, searchText);
        if (allMatches.length === 0) return false;
        
        // 원래 위치에 가장 가까운 일치하는 텍스트 찾기
        let closestMatch = allMatches[0];
        let minDistance = Math.abs(closestMatch - originalPosition);
        
        for (const match of allMatches) {
            const distance = Math.abs(match - originalPosition);
            if (distance < minDistance) {
                minDistance = distance;
                closestMatch = match;
            }
        }
        
        // 가장 가까운 일치 텍스트 대체
        const matchFromPos = editor.offsetToPos(closestMatch);
        const matchToPos = editor.offsetToPos(closestMatch + searchText.length);
        
        editor.setSelection(matchFromPos, matchToPos);
        editor.replaceSelection(replaceText);
        return true;
    }
    
    /**
     * 문자열에서 특정 텍스트의 모든 출현 위치를 찾는 함수
     * @param content 검색할 문자열
     * @param searchText 찾을 텍스트
     * @returns 모든 출현 위치의 인덱스 배열
     */
    private findAllOccurrences(content: string, searchText: string): number[] {
        const positions: number[] = [];
        let pos = content.indexOf(searchText);
        
        while (pos !== -1) {
            positions.push(pos);
            pos = content.indexOf(searchText, pos + 1);
        }
        
        return positions;
    }

    private async generateAIContent(currentContent: string, selectedText: string): Promise<{ content: string, jsonData: any }> {
        // 프론트매터 제거 및 첨부파일 링크/노트 링크 처리
        const contentWithoutFrontmatter = getContentWithoutFrontmatter(currentContent);
        const processedContent = this.processNoteContent(contentWithoutFrontmatter);
        
        const systemPrompt = `당신은 개념 분석과 지식 연결의 최고 전문가입니다.
선택된 텍스트를 중심으로 심층적인 분석을 제공하고, 전체 문맥에서의 의미와 연관성을 체계적으로 설명합니다.

분석 역량:
- 개념의 핵심 요소와 본질 파악
- 이론적 기반과 역사적 맥락 탐색
- 유사 개념과의 비교 및 차별점 도출
- 실제 적용 사례와 활용 방안 제시
- 학문적 관점과 실용적 관점의 균형 유지
- 복잡한 개념의 명확한 구조화 및 시각화

분석 방법론:
- 선택된 텍스트의 핵심 개념 정확히 정의
- 문맥 내에서의 위치와 중요성 평가
- 관련 개념과의 연결망 구축
- 다양한 관점에서의 해석 제공
- 심층적 이해를 위한 계층적 설명
- 개념의 한계와 발전 가능성 탐색

구조화 원칙:
- 주요 섹션은 헤더(#, ##, ###)를 사용해 명확한 계층 구조 제공
- 중요 개념은 적절한 헤더 레벨로 구분하여 체계적으로 조직화
- 논리적 그룹화와 관계성 명확히 표현
- 중복 정보 제거 및 통합
- 핵심 정보 우선 배치
- 개념 간 연결성과 인과관계 명확히 표현

포맷팅 규칙:
- 주요 섹션은 # 또는 ## 헤더로 명확히 구분
- 소제목과 중요 개념은 ### 또는 #### 수준의 헤더로 구분
- 중요 개념이나 키워드는 **볼드체**로 강조
- 정의나 특별한 용어는 *이탤릭체*로 표시
- 핵심 아이디어나 중요 포인트는 ==하이라이트==로 강조
- 목록이 필요한 경우 불릿 포인트(-)나 번호 목록(1., 2.)을 적절히 활용
- 세부 항목은 들여쓰기로 계층 구조 표현
- 인용이 필요한 경우 > 블록인용구 활용
- 표나 수식이 필요한 경우 마크다운 표기법 활용
- 링크는 [텍스트](URL) 형식으로 포함

결과물 구성:
- 핵심 개념: 선택된 텍스트의 본질적 의미와 중요 요소 명확히 정의
- 상세 분석: 개념의 구성 요소, 특성, 원리에 대한 체계적 설명
- 맥락적 의미: 전체 문서와의 관계 및 위치적 중요성 평가
- 관련 개념: 연관된 이론, 개념, 아이디어와의 연결성 제시
- 실용적 응용: 실제 적용 사례와 활용 방안
- 참고 자료: 추가 학습을 위한 관련 리소스 제안`;

        // 태그와 별칭 생성을 위한 프롬프트 추가
        const tagsPrompt = `
또한, 다음 요구사항에 따라 현재 노트의 키워드("${selectedText}")와 정확히 관련된 태그와 별칭(aliases)도 함께 생성해주세요:
1. 태그: 현재 노트 주제와 직접 관련된 가장 핵심 3-5개의 태그 제안 (각 태그는 #없이 단일 단어로, 소문자 영어로 작성)
2. 별칭: 현재 노트 제목의 다른 표현 또는 유사어 1-3개 (각 별칭은 작은따옴표 없이)

태그와 별칭은 문서 마지막에 다음 JSON 형식으로 추가:
\`\`\`json
{
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "aliases": ["별칭1", "별칭2", "별칭3"]
}
\`\`\``;

        const userPrompt = `${systemPrompt}

다음은 전체 문서 내용입니다:
${processedContent}

다음은 분석이 필요한 선택된 텍스트입니다:
${selectedText}

변환 규칙:
- 주요 섹션은 # 또는 ## 헤더로 명확히 구분
- 소제목과 중요 개념은 ### 또는 #### 수준의 헤더로 구분
- 중요 개념이나 키워드는 **볼드체**로 강조
- 정의나 특별한 용어는 *이탤릭체*로 표시
- 핵심 아이디어나 중요 포인트는 ==하이라이트==로 강조
- 목록이 필요한 경우 불릿 포인트(-) 또는 번호 목록(1., 2.)을 적절히 활용
- 복잡한 정보는 표 형식으로 구조화
- 인용이 필요한 경우 > 블록인용구 활용
- 내용의 논리적 구조 유지 및 강화
- 변환 과정 설명 없이 결과만 출력

${tagsPrompt}`;

        const response = await requestToAI(this.plugin, {
            userPrompt
        });
        
        // JSON 데이터 추출
        let content = response;
        let jsonData = null;
        
        // 1. 코드 블록 안의 JSON 찾기
        let jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
            try {
                jsonData = JSON.parse(jsonMatch[1]);
                // JSON 부분 제거
                content = response.replace(/```json\n[\s\S]*?\n```/, '').trim();
            } catch (error) {
                console.error('JSON 파싱 오류:', error);
            }
        }
        
        // 2. 코드 블록에서 찾지 못했으면 일반 텍스트 JSON 찾기
        if (!jsonData) {
            // 문서 끝부분에서 JSON 형식 객체를 찾는 정규식
            // 태그와 별칭을 포함하는 JSON 객체를 찾음
            const jsonRegex = /\{[\s\S]*?"tags"[\s\S]*?"aliases"[\s\S]*?\}/;
            jsonMatch = response.match(jsonRegex);
            
            if (jsonMatch) {
                try {
                    jsonData = JSON.parse(jsonMatch[0]);
                    // JSON 부분 제거
                    content = response.replace(jsonMatch[0], '').trim();
                } catch (error) {
                    console.error('일반 텍스트 JSON 파싱 오류:', error);
                }
            }
        }
        
        // 3. JSON을 추출하지 못했더라도 노트 내용에 JSON 형식이 포함되는 것 방지
        if (!jsonData) {
            // 태그와 별칭을 포함하는 JSON 형식 텍스트를 찾아 제거
            const cleanupRegex = /\{[\s\S]*?"tags"[\s\S]*?"aliases"[\s\S]*?\}/;
            content = content.replace(cleanupRegex, '').trim();
        }

        return { content, jsonData };
    }

    private processNoteContent(content: string): string {
        // 첨부파일 링크 제거 (![[...]])
        content = content.replace(/!\[\[.*?\]\]/g, '');
        
        // 노트 링크를 표시 텍스트로 변환 ([[경로/노트명|표시텍스트]] -> 표시텍스트)
        content = content.replace(/\[\[.*?\|(.+?)\]\]/g, '$1');
        
        // 표시 텍스트가 없는 노트 링크 처리 ([[경로/노트명]] -> 노트명)
        content = content.replace(/\[\[(.*?)\]\]/g, (match, path) => {
            const noteName = path.split('/').pop(); // 경로에서 노트명만 추출
            return noteName || match;
        });
        
        return content;
    }
}
