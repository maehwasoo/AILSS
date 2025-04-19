import { App, TFile } from 'obsidian';
import type AILSSPlugin from 'main';
import { PathSettings } from '../settings/pathSettings';

interface FileStats {
    noteCount: number;
    attachmentCount: number;
    lastUpdate: number;
}

export class FileCountManager {
    private static instance: FileCountManager;
    private readonly STATS_KEY = 'fileStats';  // 통계 데이터용 키 추가
    private stats: FileStats = {
        noteCount: 0,
        attachmentCount: 0,
        lastUpdate: 0
    };
    
    private constructor(
        private app: App,
        private plugin: AILSSPlugin
    ) {
        this.initializeListeners();
    }

    static getInstance(app: App, plugin: AILSSPlugin): FileCountManager {
        if (!FileCountManager.instance) {
            FileCountManager.instance = new FileCountManager(app, plugin);
        }
        return FileCountManager.instance;
    }

    private async initializeListeners(): Promise<void> {
        // 파일 생성 이벤트
        this.plugin.registerEvent(
            this.app.vault.on('create', async (file) => {
                if (file instanceof TFile) {
                    await this.updateCounts();
                }
            })
        );

        // 파일 삭제 이벤트
        this.plugin.registerEvent(
            this.app.vault.on('delete', async (file) => {
                if (file instanceof TFile) {
                    await this.updateCounts();
                }
            })
        );

        // 초기 카운트 업데이트
        await this.updateCounts();
    }

    private async updateCounts(): Promise<void> {
        const allFiles = this.app.vault.getFiles();
        let noteCount = 0;
        let attachmentCount = 0;

        allFiles.forEach((file: TFile) => {
            if (PathSettings.isValidPath(file.path)) {
                if (file.extension === 'md') {
                    noteCount++;
                } else {
                    attachmentCount++;
                }
            }
        });

        this.stats = {
            noteCount,
            attachmentCount,
            lastUpdate: Date.now()
        };

        // 데이터 저장
        await this.saveStats();
    }

    private async saveStats(): Promise<void> {
        // 플러그인의 전체 데이터를 먼저 로드
        const allData = await this.plugin.loadData() || {};
        // 통계 데이터만 업데이트
        allData[this.STATS_KEY] = this.stats;
        // 전체 데이터 저장
        await this.plugin.saveData(allData);
    }
    
    async getNoteCount(): Promise<number> {
        return this.stats.noteCount;
    }

    async getAttachmentCount(): Promise<number> {
        return this.stats.attachmentCount;
    }

    async getLastUpdate(): Promise<number> {
        return this.stats.lastUpdate;
    }
} 