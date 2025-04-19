import { App, Notice } from 'obsidian';
import { DEFAULT_GRAPH_CONFIG } from './defaultGraphConfig';
import AILSSPlugin from '../../../../main';

export class GraphManager {
    constructor(
        private app: App,
        private plugin: AILSSPlugin
    ) {
        // 워크스페이스 레이아웃이 준비되면 로컬 그래프 설정을 적용
        this.app.workspace.onLayoutReady(() => {
            this.applyLocalGraphConfig();
        });

        // 새로운 로컬 그래프 뷰가 생성될 때마다 설정 적용
        this.app.workspace.on('layout-change', () => {
            this.applyLocalGraphConfig();
        });
    }

    private async applyLocalGraphConfig() {
        const leaves = this.app.workspace.getLeavesOfType('localgraph');
        
        // 이미 로컬 그래프가 열려있는 경우 추가 생성 방지
        if (leaves.length > 1) {
            leaves[leaves.length - 1].detach();
            new Notice('로컬 그래프 뷰는 하나만 열 수 있습니다.');
            return;
        }

        // iOS에서 뷰가 완전히 로드될 때까지 잠시 대기
        //await new Promise(resolve => setTimeout(resolve, 0));

        const leaf = leaves[0];
        if (!leaf || !leaf.view) return;

        const view = leaf.view as any;
        
        // 그래프 설정만 적용하고 다른 설정은 유지
        const graphSettings = {
            ...view.options,  // 기존 설정 유지
            ...DEFAULT_GRAPH_CONFIG  // 그래프 관련 설정만 덮어쓰기
        };

        // 기존 설정 적용
        if (view.options) {
            Object.assign(view.options, graphSettings);
        }
        if (view.renderer?.settings) {
            Object.assign(view.renderer.settings, graphSettings);
        }

        // 뷰 상태 업데이트
        const viewState = leaf.getViewState();
        if (!viewState.state) viewState.state = {};
        viewState.state.options = {
            ...(typeof viewState.state.options === 'object' ? viewState.state.options : {}),
            ...graphSettings
        };
        leaf.setViewState(viewState);

        // 렌더러 리셋 및 새로고침
        if (view.renderer) {
            if (typeof view.renderer.reset === 'function') {
                view.renderer.reset();
            }
            if (typeof view.renderer.onIframeLoad === 'function') {
                view.renderer.onIframeLoad();
            }
        }
        if (typeof view.load === 'function') {
            view.load();
        }
    }

    /**
     * 그래프 설정을 적용하는 메서드
     */
    async applyGraphConfig() {
        try {
            await this.applyLocalGraphConfig();
        } catch (error) {
            console.error('로컬 그래프 설정 적용 중 오류:', error);
            new Notice('그래프 설정 적용 중 오류가 발생했습니다.');
        }
    }
}
