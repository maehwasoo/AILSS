export function getContentWithoutFrontmatter(content: string): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    return content.replace(frontmatterRegex, '').trim();
} 