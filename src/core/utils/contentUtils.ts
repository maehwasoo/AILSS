export function getContentWithoutFrontmatter(content: string): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    return content.replace(frontmatterRegex, '').trim();
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
 * 콘텐츠에서 모든 Obsidian 링크(노트 링크, 첨부 파일 링크)를 추출합니다.
 * @param content 콘텐츠
 * @returns 추출된 링크 배열
 */
export function extractLinks(content: string): string[] {
    const links: string[] = [];
    let match;
    
    while ((match = LINK_REGEX.allLinks.exec(content)) !== null) {
        links.push(match[0]); // 전체 링크 문자열 저장
    }
    
    return links;
}

/**
 * 링크 정보를 저장하는 인터페이스
 */
interface LinkPlaceholder {
    placeholder: string;
    originalLink: string;
}

/**
 * 콘텐츠에서 링크를 찾아 플레이스홀더로 대체합니다.
 * @param content 콘텐츠
 * @returns 대체된 콘텐츠와 플레이스홀더 맵
 */
export function replaceLinksWithPlaceholders(content: string): { 
    modifiedContent: string; 
    linkPlaceholders: LinkPlaceholder[] 
} {
    const linkPlaceholders: LinkPlaceholder[] = [];
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
 * 플레이스홀더를 원래 링크로 복원합니다.
 * @param content 플레이스홀더가 있는 콘텐츠
 * @param linkPlaceholders 플레이스홀더 맵
 * @returns 링크가 복원된 콘텐츠
 */
export function restoreLinksFromPlaceholders(
    content: string, 
    linkPlaceholders: LinkPlaceholder[]
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