import { App, moment, TFile } from 'obsidian';
import { FileCountManager } from '../utils/fileCountManager';
import type AILSSPlugin from 'main';
import { FrontmatterManager } from '../utils/frontmatterManager';

export class PathSettings {
    // 기본 경로 포맷
    static readonly PATH_FORMAT = 'YYYY/MM/DD';
    
    // 특수 폴더명
    static readonly DEACTIVATED_ROOT = 'deactivated';
    
    // 폴더 깊이 제한
    static readonly MAX_FOLDER_DEPTH = 6; // deactivated/태그이름/YYYY/MM/DD 구조 고려
    
    // 파일 관련 설정
    static readonly DEFAULT_FILE_EXTENSION = '.md';
    static readonly DEFAULT_UNTITLED = 'untitled';
    
    // 최대 노트 개수 제한
    static readonly MAX_NOTES = 32768; 
    
    // 경로 포맷 관련 정규식 수정
    static readonly PATH_REGEX = /^\d{4}\/\d{2}\/\d{2}$/;
    
    /**
     * 노트 생성을 위한 통합 유틸리티 메서드
     */
    static async createNote(params: {
        app: App,
        frontmatterConfig: Record<string, any>,
        content: string,
        timestamp?: moment.Moment,
        isInherited?: boolean
    }): Promise<{
        file: TFile,
        fileName: string,
        timestamp: moment.Moment
    }> {
        const {
            app,
            frontmatterConfig,
            content,
            timestamp: initialTimestamp = moment(),
            isInherited = false
        } = params;

        // 유니크한 파일명과 타임스탬프 생성
        const { fileName, timestamp } = await this.generateUniqueFileInfo(
            app,
            initialTimestamp
        );

        // 기존 PATH_FORMAT 사용하여 폴더 경로 생성
        const folderPath = this.getTimestampedPath(timestamp);

        // 폴더 생성
        if (!(await app.vault.adapter.exists(folderPath))) {
            await app.vault.createFolder(folderPath);
        }

        // 업데이트된 타임스탬프를 프론트매터에 반영
        const updatedFrontmatterConfig = { ...frontmatterConfig };
        // id 필드 업데이트
        updatedFrontmatterConfig.id = timestamp.format('YYYYMMDDHHmmss');
        // date와 updated 필드 업데이트 (한국시간 UTC+9)
        const koreanTime = timestamp.clone().add(9, 'hours');
        updatedFrontmatterConfig.date = koreanTime.toISOString().split('.')[0];
        updatedFrontmatterConfig.updated = koreanTime.toISOString().split('.')[0];

        // frontmatter 생성 (업데이트된 timestamp 적용)
        const frontmatterManager = new FrontmatterManager();
        const noteContent = frontmatterManager.generateFrontmatter(
            updatedFrontmatterConfig,
            isInherited
        ) + `\n${content}`;

        // 노트 생성
        const file = await app.vault.create(
            `${folderPath}/${fileName}`,
            noteContent
        );

        return {
            file,
            fileName,
            timestamp
        };
    }

    /**
     * 유니크한 파일명과 타임스탬프 생성
     */
    private static async generateUniqueFileInfo(
        app: App,
        initialTimestamp: moment.Moment
    ): Promise<{
        fileName: string,
        timestamp: moment.Moment
    }> {
        let currentTimestamp = moment(initialTimestamp);
        let fileName: string;
        
        do {
            fileName = `${currentTimestamp.format('YYYYMMDDHHmmss')}${this.DEFAULT_FILE_EXTENSION}`;
            const folderPath = this.getTimestampedPath(currentTimestamp);
            const fullPath = `${folderPath}/${fileName}`;

            if (!(await app.vault.adapter.exists(fullPath))) {
                break;
            }

            currentTimestamp = currentTimestamp.add(1, 'second');
        } while (true);

        return {
            fileName,
            timestamp: currentTimestamp
        };
    }

    // 경로 생성 헬퍼 메서드
    static getTimestampedPath(date: moment.Moment): string {
        return date.format(PathSettings.PATH_FORMAT);
    }
    
    // 파일명 생성 헬퍼 메서드
    static getDefaultFileName(counter?: number): string {
        const timestamp = moment().format('YYYYMMDDHHmmss');
        return `${timestamp}${this.DEFAULT_FILE_EXTENSION}`;
    }
    
    // 노트 개수 확인 메서드 수정
    static async checkNoteLimit(app: App, plugin: AILSSPlugin): Promise<boolean> {
        const fileCountManager = FileCountManager.getInstance(app, plugin);
        const noteCount = await fileCountManager.getNoteCount();
        return noteCount < this.MAX_NOTES;
    }
    
    // 경로 검증 헬퍼 메서드 수정
    static isValidPath(path: string): boolean {
        // 루트 경로는 유효한 것으로 처리
        if (path === '/') return true;
        
        // 경로를 / 기준으로 분리
        const parts = path.split('/').filter(p => p.length > 0);
        
        // 빈 경로는 유효하지 않음
        if (parts.length === 0) return false;
        
        // YYYY/MM/DD 형식 검사
        if (parts.length === 3) {
            return this.PATH_REGEX.test(parts.join('/'));
        }
        
        return true;
    }
} 