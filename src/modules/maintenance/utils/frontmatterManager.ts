import { moment } from 'obsidian';
import type AILSSPlugin from 'main';

interface DefaultFrontmatterConfig {
    Created: string;
    Activated: string;
    Potentiation: number;
    tags: string[];
}

export class FrontmatterManager {
    public static readonly DEFAULT_TAGS = ['Initial'];
    private static readonly INITIAL_POTENTIATION = 0;
    private static readonly MAX_POTENTIATION = 100;
    private static readonly POTENTIATION_INCREMENT = 1;
    private static readonly POTENTIATION_DELAY_MINUTES = 10;

    constructor() {}

    private getDefaultFrontmatter(now: moment.Moment): DefaultFrontmatterConfig {
        return {
            Created: now.format('YYYY-MM-DD HH:mm'),
            Activated: now.format('YYYY-MM-DD HH:mm'),
            Potentiation: FrontmatterManager.INITIAL_POTENTIATION,
            tags: [...FrontmatterManager.DEFAULT_TAGS]
        };
    }

    // 프론트매터 생성 메서드
    generateFrontmatter(additionalFields: Record<string, any> = {}, isLinkNote: boolean = false): string {
        const now = moment();
        const defaultFields = isLinkNote 
            ? this.getDefaultFrontmatter(now)
            : this.getDefaultFrontmatter(now);

        const mergedFields = { ...defaultFields, ...additionalFields };

        let yaml = '---\n';
        Object.entries(mergedFields).forEach(([key, value]) => {
            if (Array.isArray(value)) {
                yaml += `${key}:\n${value.map(v => `  - ${v}`).join('\n')}\n`;
            } else {
                yaml += `${key}: ${value}\n`;
            }
        });
        yaml += '---\n';

        return yaml;
    }

    // Potentiation 관련 유틸리티 메서드들
    static isPotentiationMaxed(currentPotentiation: number): boolean {
        return currentPotentiation >= this.MAX_POTENTIATION;
    }

    static getPotentiationIncrement(): number {
        return this.POTENTIATION_INCREMENT;
    }

    static getPotentiationDelay(): number {
        return this.POTENTIATION_DELAY_MINUTES;
    }

    parseFrontmatter(content: string): Record<string, any> | null {
        const frontMatterRegex = /^---\n([\s\S]*?)\n---/;
        const match = content.match(frontMatterRegex);
        if (!match) return null;

        const frontmatter: Record<string, any> = {};
        const lines = match[1].split('\n');
        
        let currentKey: string | null = null;
        let currentArray: string[] = [];

        lines.forEach(line => {
            if (line.trim() === '') return;

            if (line.startsWith('  - ')) {
                if (currentKey) {
                    currentArray.push(line.substring(4));
                }
            } else {
                if (currentKey && currentArray.length > 0) {
                    frontmatter[currentKey] = currentArray;
                    currentArray = [];
                }

                const [key, ...values] = line.split(':').map(s => s.trim());
                if (key && values.length > 0) {
                    currentKey = key;
                    const value = values.join(':');
                    if (value.trim() === '') {
                        currentArray = [];
                    } else {
                        frontmatter[key] = value;
                        currentKey = null;
                    }
                }
            }
        });

        if (currentKey && currentArray.length > 0) {
            frontmatter[currentKey] = currentArray;
        }

        return frontmatter;
    }

    updateFrontmatter(content: string, updates: Record<string, any>): string {
        const frontMatterRegex = /^---\n([\s\S]*?)\n---/;
        const match = content.match(frontMatterRegex);
        
        if (!match) return content;

        const currentFrontmatter = this.parseFrontmatter(content) || {};
        const updatedFrontmatter = { ...currentFrontmatter, ...updates };
        const newFrontmatter = this.generateFrontmatter(updatedFrontmatter);

        return content.replace(frontMatterRegex, newFrontmatter);
    }

    // 태그가 기본 태그만 있는지 확인하는 메서드
    static hasOnlyDefaultTags(tags: string[]): boolean {
        return tags.every(tag => this.DEFAULT_TAGS.includes(tag));
    }

    // 기본 태그를 제외한 태그들을 반환하는 메서드
    static getNonDefaultTags(tags: string[]): string[] {
        return tags.filter(tag => !this.DEFAULT_TAGS.includes(tag));
    }
} 