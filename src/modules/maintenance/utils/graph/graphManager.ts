import { App, Notice } from 'obsidian';
import { DEFAULT_GRAPH_CONFIG } from './defaultGraphConfig';
import AILSSPlugin from '../../../../../main';

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
        // 최대 3번 시도
        for (let attempt = 0; attempt < 3; attempt++) {
            // iOS에서 뷰가 완전히 로드될 때까지 잠시 대기
            await new Promise(resolve => setTimeout(resolve, 300));

            const leaves = this.app.workspace.getLeavesOfType('localgraph');
            let appliedCount = 0;

            for (const leaf of leaves) {
                const view = leaf.view as any;
                if (!view) continue;

                try {
                    // 그래프 설정만 적용하고 다른 설정은 유지
                    const graphSettings = {
                        ...view.options,  // 기존 설정 유지
                        ...DEFAULT_GRAPH_CONFIG  // 그래프 관련 설정만 덮어쓰기
                    };

                    // 기존 설정 적용 로직 수정
                    if (view.options) {
                        Object.assign(view.options, graphSettings);
                    }
                    if (view.renderer?.settings) {
                        Object.assign(view.renderer.settings, graphSettings);
                    }

                    // 뷰 상태 업데이트 시에도 기존 설정 유지
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

                    appliedCount++;
                } catch (error) {
                    console.warn('그래프 설정 적용 실패:', error);
                }
            }

            // 모든 그래프에 설정이 적용되었다면 종료
            if (appliedCount === leaves.length && leaves.length > 0) {
                break;
            }
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
