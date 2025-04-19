import { App, Notice } from 'obsidian';
import AILSSPlugin from '../../../../../main';
import { DEFAULT_GLOBAL_GRAPH } from './defaultGlobalGraph';

export class GlobalGraphManager {
    constructor(
        private app: App,
        private plugin: AILSSPlugin
    ) {}

    /**
     * 기본 글로벌 그래프 설정을 graph.json에 저장
     */
    async applyGlobalGraphConfig() {
        try {
            await this.app.vault.adapter.write(
                '.obsidian/graph.json',
                JSON.stringify(DEFAULT_GLOBAL_GRAPH, null, 2)
            );
            new Notice('글로벌 그래프 설정이 저장되었습니다.');
        } catch (error) {
            console.error('글로벌 그래프 설정 저장 중 오류:', error);
            new Notice('글로벌 그래프 설정 저장 중 오류가 발생했습니다.');
        }
    }
}
