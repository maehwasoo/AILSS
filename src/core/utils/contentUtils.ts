export function getContentWithoutFrontmatter(content: string): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    return content.replace(frontmatterRegex, '').trim();
}

/**
 * 링크 종류를 정의하는 Enum
 */
export enum LinkType {
    NoteLink = 'note',
    AttachmentLink = 'attachment'
}

/**
 * Obsidian 노트 및 첨부 파일 링크를 찾는 정규식
 */
const LINK_REGEX = {
    // 일반 노트 링크: [[타임스탬프|별칭]]
    noteLink: /\[\[(.*?)(?:\|(.*?))?\]\]/g,
    // 첨부 파일 링크: ![[타임스탬프|별칭]]
    attachmentLink: /!\[\[(.*?)(?:\|(.*?))?\]\]/g,
    // 모든 링크 (노트 + 첨부 파일)
    allLinks: /(!?\[\[(.*?)(?:\|(.*?))?\]\])/g
};

/**
 * 링크 정보를 저장하는 인터페이스
 */
export interface LinkInfo {
    fullLink: string;       // 전체 링크 문자열: [[타임스탬프|별칭]] 또는 ![[타임스탬프|별칭]]
    timestamp: string;      // 타임스탬프 또는 파일 경로 부분
    alias?: string;         // 별칭(있는 경우)
    type: LinkType;         // 링크 유형(노트 또는 첨부파일)
}

/**
 * 링크 플레이스홀더 정보
 */
interface LinkPlaceholder {
    placeholder: string;
    originalLink: string;
    linkInfo: LinkInfo;
}

/**
 * 콘텐츠에서 모든 Obsidian 링크(노트 링크, 첨부 파일 링크)를 추출합니다.
 * @param content 콘텐츠
 * @param type 추출할 링크 유형 (기본값: 모든 링크)
 * @returns 추출된 링크 정보 배열
 */
export function extractLinks(content: string, type?: LinkType): LinkInfo[] {
    const links: LinkInfo[] = [];
    let regex;
    
    if (type === LinkType.NoteLink) {
        regex = LINK_REGEX.noteLink;
    } else if (type === LinkType.AttachmentLink) {
        regex = LINK_REGEX.attachmentLink;
    } else {
        regex = LINK_REGEX.allLinks;
    }
    
    let match;
    while ((match = regex.exec(content)) !== null) {
        const fullLink = match[0];
        const isAttachment = fullLink.startsWith('!');
        const path = match[2] || match[1]; // 첫 번째 캡처 그룹(링크 내용)
        const alias = match[3] || undefined; // 두 번째 캡처 그룹(별칭, 있는 경우)
        
        links.push({
            fullLink,
            timestamp: path,
            alias,
            type: isAttachment ? LinkType.AttachmentLink : LinkType.NoteLink
        });
    }
    
    return links;
}

/**
 * 콘텐츠에서 링크를 찾아 AI 처리를 위해 특수한 플레이스홀더로 대체합니다.
 * 노트 링크는 AI가 별칭을 문맥에 맞게 처리할 수 있도록 변환합니다.
 * 
 * @param content 콘텐츠
 * @returns 변환된 콘텐츠와 플레이스홀더 맵
 */
export function prepareLinksForAI(content: string): { 
    modifiedContent: string; 
    linkPlaceholders: LinkPlaceholder[] 
} {
    const linkPlaceholders: LinkPlaceholder[] = [];
    let modifiedContent = content;
    let counter = 0;
    
    // 모든 링크 찾기
    const allLinks = extractLinks(content);
    
    // 각 링크 처리
    for (const linkInfo of allLinks) {
        const { fullLink, alias, type } = linkInfo;
        
        // 링크 별칭이 없는 경우 그대로 유지
        if (!alias) {
            const placeholder = `{{OBSIDIAN_LINK_${counter++}}}`;
            linkPlaceholders.push({ 
                placeholder, 
                originalLink: fullLink,
                linkInfo
            });
            modifiedContent = modifiedContent.replace(fullLink, placeholder);
            continue;
        }
        
        if (type === LinkType.NoteLink) {
            // 노트 링크는 별칭을 일반 텍스트처럼 취급하되, 링크 정보를 보존
            const placeholder = `${alias}{{OBSIDIAN_NOTELINK_${counter++}}}`;
            linkPlaceholders.push({ 
                placeholder, 
                originalLink: fullLink,
                linkInfo
            });
            modifiedContent = modifiedContent.replace(fullLink, placeholder);
        } else {
            // 첨부 파일 링크는 완전히 플레이스홀더로 대체
            const placeholder = `{{OBSIDIAN_ATTACHMENTLINK_${counter++}}}`;
            linkPlaceholders.push({ 
                placeholder, 
                originalLink: fullLink,
                linkInfo
            });
            modifiedContent = modifiedContent.replace(fullLink, placeholder);
        }
    }
    
    return { modifiedContent, linkPlaceholders };
}

/**
 * AI 처리 후 콘텐츠에서 노트 링크 플레이스홀더를 원래 링크 형식으로 복원합니다.
 * 
 * @param content AI가 처리한 콘텐츠
 * @param linkPlaceholders 링크 플레이스홀더 맵
 * @returns 링크가 복원된 콘텐츠
 */
export function restoreLinksFromAI(
    content: string, 
    linkPlaceholders: LinkPlaceholder[]
): string {
    let restoredContent = content;
    
    // 노트 링크 플레이스홀더 처리 (별칭과 함께 있는 형태)
    for (const { placeholder, originalLink, linkInfo } of linkPlaceholders) {
        if (linkInfo.type === LinkType.NoteLink && linkInfo.alias) {
            // 별칭 + 플레이스홀더 형태의 패턴 찾기
            const pattern = new RegExp(`${linkInfo.alias}\\{\\{OBSIDIAN_NOTELINK_\\d+\\}\\}`, 'g');
            restoredContent = restoredContent.replace(pattern, originalLink);
        }
    }
    
    // 나머지 플레이스홀더 처리
    for (const { placeholder, originalLink } of linkPlaceholders) {
        // 정규식 특수문자 이스케이프
        const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        restoredContent = restoredContent.replace(
            new RegExp(escapedPlaceholder, 'g'), 
            originalLink
        );
    }
    
    return restoredContent;
}

/**
 * 첨부 파일 링크를 통합 노트의 하단으로 이동시킵니다.
 * 
 * @param contentWithLinks 링크가 있는 콘텐츠
 * @param attachmentLinks 이동시킬 첨부 파일 링크 목록
 * @returns 첨부 파일 링크가 하단에 추가된 콘텐츠
 */
export function moveAttachmentLinksToBottom(contentWithLinks: string, attachmentLinks: LinkInfo[]): string {
    if (attachmentLinks.length === 0) {
        return contentWithLinks;
    }
    
    // 중복 링크 제거
    const uniqueLinks = new Set<string>();
    const filteredLinks = attachmentLinks.filter(link => {
        if (!uniqueLinks.has(link.fullLink)) {
            uniqueLinks.add(link.fullLink);
            return true;
        }
        return false;
    });
    
    if (filteredLinks.length === 0) {
        return contentWithLinks;
    }
    
    // 콘텐츠 하단에 첨부 파일 섹션 추가
    let result = contentWithLinks.trim();
    result += '\n\n## 첨부 파일\n';
    
    // 링크 추가
    for (const link of filteredLinks) {
        result += `\n${link.fullLink}`;
    }
    
    return result;
}

/**
 * 기존 replaceLinksWithPlaceholders 함수 유지 (하위 호환성)
 * @deprecated prepareLinksForAI 함수 사용 권장
 */
export function replaceLinksWithPlaceholders(content: string): { 
    modifiedContent: string; 
    linkPlaceholders: { placeholder: string; originalLink: string }[] 
} {
    const linkPlaceholders: { placeholder: string; originalLink: string }[] = [];
    let modifiedContent = content;
    let counter = 0;
    
    // 링크를 찾아 플레이스홀더로 대체
    modifiedContent = modifiedContent.replace(LINK_REGEX.allLinks, (match) => {
        const placeholder = `{{OBSIDIAN_LINK_${counter++}}}`;
        linkPlaceholders.push({ placeholder, originalLink: match });
        return placeholder;
    });
    
    return { modifiedContent, linkPlaceholders };
}

/**
 * 기존 restoreLinksFromPlaceholders 함수 유지 (하위 호환성)
 * @deprecated restoreLinksFromAI 함수 사용 권장
 */
export function restoreLinksFromPlaceholders(
    content: string, 
    linkPlaceholders: { placeholder: string; originalLink: string }[]
): string {
    let restoredContent = content;
    
    // 모든 플레이스홀더를 원래 링크로 대체
    for (const { placeholder, originalLink } of linkPlaceholders) {
        restoredContent = restoredContent.replace(
            new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 
            originalLink
        );
    }
    
    return restoredContent;
}