import { moment } from 'obsidian';
import type AILSSPlugin from 'main';

export interface DefaultFrontmatterConfig {
    title: string;
    id: string;
    date: string;
    aliases: string[];
    tags: string[];
    potentiation: number;
    updated: string;
}

export class FrontmatterManager {
    public static readonly DEFAULT_TAGS = ['Inbox'];
    public static readonly DEFAULT_UNTITLED = 'untitled';
    public static readonly INITIAL_POTENTIATION = 0;
    public static readonly MAX_POTENTIATION = 100;
    public static readonly POTENTIATION_INCREMENT = 1;
    public static readonly POTENTIATION_DELAY_MINUTES = 10;

    constructor() {}

    private getDefaultFrontmatter(now: moment.Moment, isLinkNote: boolean = false): DefaultFrontmatterConfig {
        const timestamp = now.format('YYYYMMDDHHmmss');
        const koreanTime = now.add(9, 'hours');  // UTC+9 적용
        const defaultTitle = FrontmatterManager.DEFAULT_UNTITLED;
        
        return {
            title: defaultTitle,
            aliases: isLinkNote ? [] : [defaultTitle],
            tags: [...FrontmatterManager.DEFAULT_TAGS],
            date: koreanTime.toISOString().split('.')[0],
            id: timestamp,
            potentiation: FrontmatterManager.INITIAL_POTENTIATION,
            updated: koreanTime.toISOString().split('.')[0]
        };
    }

    // 프론트매터 생성 메서드
    generateFrontmatter(additionalFields: Record<string, any> = {}, isLinkNote: boolean = false): string {
        const now = moment();
        const defaultFields = this.getDefaultFrontmatter(now, isLinkNote);

        // created와 activated 필드를 새로운 필드명으로 매핑 (한국 시간대 적용)
        if (additionalFields.created) {
            additionalFields.date = moment(additionalFields.created)
                .add(9, 'hours')
                .toISOString()
                .split('.')[0];
            delete additionalFields.created;
        }
        if (additionalFields.activated) {
            additionalFields.updated = moment(additionalFields.activated)
                .add(9, 'hours')
                .toISOString()
                .split('.')[0];
            delete additionalFields.activated;
        }

        // 링크 노트인 경우 aliases에 title 값 추가
        if (isLinkNote && additionalFields.title) {
            additionalFields.aliases = [additionalFields.title];
        }

        const mergedFields = { ...defaultFields, ...additionalFields };
        
        // 프론트매터 순서 정의
        const orderedKeys = ['title', 'aliases', 'tags', 'date', 'id', 'potentiation', 'updated'];
        
        let yaml = '---\n';
        // 정의된 순서대로 먼저 처리
        orderedKeys.forEach((key: keyof DefaultFrontmatterConfig) => {
            if (key in mergedFields) {
                const value = mergedFields[key];
                if (Array.isArray(value)) {
                    if (key === 'aliases') {
                        yaml += `${key}:\n${value.map(v => {
                            // 값이 이미 따옴표로 감싸져 있는지 확인
                            const cleanValue = this.removeQuotes(v);
                            return `  - '${cleanValue}'`;
                        }).join('\n')}\n`;
                    } else {
                        yaml += `${key}:\n${value.map(v => `  - ${v}`).join('\n')}\n`;
                    }
                } else {
                    if (key === 'title') {
                        // 값이 이미 따옴표로 감싸져 있는지 확인
                        const cleanValue = this.removeQuotes(value);
                        yaml += `${key}: '${cleanValue}'\n`;
                    } else {
                        yaml += `${key}: ${value}\n`;
                    }
                }
                delete mergedFields[key];
            }
        });
        
        // 나머지 필드들 처리
        Object.entries(mergedFields).forEach(([key, value]) => {
            if (Array.isArray(value)) {
                if (key === 'aliases') {
                    yaml += `${key}:\n${value.map(v => {
                        // 값이 이미 따옴표로 감싸져 있는지 확인
                        const cleanValue = this.removeQuotes(v);
                        return `  - '${cleanValue}'`;
                    }).join('\n')}\n`;
                } else {
                    yaml += `${key}:\n${value.map(v => `  - ${v}`).join('\n')}\n`;
                }
            } else {
                if (key === 'title') {
                    // 값이 이미 따옴표로 감싸져 있는지 확인
                    const cleanValue = this.removeQuotes(value);
                    yaml += `${key}: '${cleanValue}'\n`;
                } else {
                    yaml += `${key}: ${value}\n`;
                }
            }
        });
        yaml += '---';

        return yaml;
    }

    // 텍스트에서 시작과 끝의 작은따옴표 제거
    public removeQuotes(text: any): string {
        if (typeof text !== 'string') return String(text);
        return text.replace(/^'|'$/g, '');
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
                    let value = line.substring(4).trim();
                    // aliases 배열 항목의 작은따옴표 제거
                    if (currentKey === 'aliases') {
                        value = this.removeQuotes(value);
                    }
                    currentArray.push(value);
                }
            } else {
                if (currentKey && currentArray.length > 0) {
                    frontmatter[currentKey] = currentArray;
                    currentArray = [];
                }

                const [key, ...values] = line.split(':').map(s => s.trim());
                if (key && values.length > 0) {
                    currentKey = key;
                    let value = values.join(':');
                    if (value.trim() === '') {
                        currentArray = [];
                    } else {
                        // title 필드의 작은따옴표 제거
                        if (key === 'title') {
                            value = this.removeQuotes(value);
                        }
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