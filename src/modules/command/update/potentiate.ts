import { App, Notice } from 'obsidian';
import type AILSSPlugin from '../../../../main';
import { FrontmatterManager } from '../../../core/utils/frontmatterManager';
import { showConfirmationDialog } from '../../../components/commonUI/confirmationModal';
import { moment } from 'obsidian';
import { NoteRecallModal } from '../../../components/potentiateUI/noteRecallModal';
import { AccuracyResult } from '../../../modules/ai/ai_utils/accuracyChecker';
import { AccuracyResultModal } from '../../../components/potentiateUI/accuracyResultModal';
import { TokenWarningModal } from '../../../components/potentiateUI/tokenWarningModal';
import { getContentWithoutFrontmatter } from '../../../core/utils/contentUtils';

export class Potentiate {
    private app: App;
    private plugin: AILSSPlugin;
    private frontmatterManager: FrontmatterManager;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.frontmatterManager = new FrontmatterManager();
    }

    async potentiateNote() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('활성화된 노트가 없습니다.');
            return;
        }

        const fileContent = await this.app.vault.read(activeFile);
        const frontmatter = this.frontmatterManager.parseFrontmatter(fileContent);

        if (!frontmatter) {
            new Notice('프론트매터가 없는 노트입니다.');
            return;
        }

        // 프론트매터를 제거한 순수 노트 내용 추출 (한 번만 수행)
        const purifiedContent = getContentWithoutFrontmatter(fileContent);

        const currentPotentiation = Number(frontmatter.potentiation) || 0;
        const lastActivated = frontmatter.updated ? new Date(frontmatter.updated) : null;

        // 최대 강화 지수 체크
        if (FrontmatterManager.isPotentiationMaxed(currentPotentiation)) {
            new Notice('이미 최대 강화 지수에 도달했습니다.');
            return;
        }

        // 대기 시간 체크
        if (lastActivated) {
            const minutesSinceLastActivation = (new Date().getTime() - lastActivated.getTime()) / (1000 * 60);
            if (minutesSinceLastActivation < FrontmatterManager.getPotentiationDelay()) {
                new Notice(`강화까지 ${Math.ceil(FrontmatterManager.getPotentiationDelay() - minutesSinceLastActivation)}분 남았습니다.`);
                return;
            }
        }

        // 1. 확인 대화상자 표시
        const confirmed = await showConfirmationDialog(this.app, {
            title: "노트 강화 확인",
            message: `현재 노트의 강화 지수를 ${currentPotentiation} → ${currentPotentiation + FrontmatterManager.getPotentiationIncrement()}로 증가시키시겠습니까?`,
            confirmText: "강화",
            cancelText: "취소"
        });

        if (!confirmed) {
            new Notice("강화가 취소되었습니다.");
            return;
        }

        // 확인 후 정확도 검증 활성화 여부에 따라 처리
        if (this.plugin.settings.enablePotentiateAccuracyCheck) {
            // 2. 토큰 경고창 표시 (순수 내용 전달)
            this.showTokenWarningModal(activeFile, fileContent, purifiedContent, currentPotentiation);
        } else {
            // 정확도 검증 비활성화 - 바로 강화 적용
            await this.applyPotentiation(activeFile, fileContent, currentPotentiation);
        }
    }

    /**
     * 토큰 경고 모달을 표시합니다.
     * @param purifiedContent 프론트매터가 제거된 순수 노트 내용
     */
    private showTokenWarningModal(activeFile: any, fileContent: string, purifiedContent: string, currentPotentiation: number) {
        const tokenWarningModal = new TokenWarningModal(
            this.app,
            purifiedContent, // 순수 노트 내용 전달
            // 계속 진행 콜백 - 노트 복기 모달 표시
            () => {
                this.showNoteRecallModal(activeFile, fileContent, purifiedContent, currentPotentiation);
            }
        );
        
        tokenWarningModal.open();
    }

    /**
     * 노트 복기 모달을 표시하고 정확도 검증을 수행합니다.
     * @param purifiedContent 프론트매터가 제거된 순수 노트 내용
     */
    private showNoteRecallModal(activeFile: any, fileContent: string, purifiedContent: string, currentPotentiation: number) {
        const modal = new NoteRecallModal(
            this.app,
            purifiedContent, // 순수 노트 내용 전달
            this.plugin.settings,
            this.plugin,
            async (result: AccuracyResult) => {
                // 정확도 결과에 따른 강화 적용
                const threshold = currentPotentiation * 10;
                const success = result.score >= threshold;
                result.success = success;
                if (success) {
                    await this.applyPotentiation(activeFile, fileContent, currentPotentiation);
                }
                
                // 4. 결과 모달 표시
                const resultModal = new AccuracyResultModal(
                    this.app,
                    result
                );
                resultModal.open();
            }
        );
        
        modal.open();
    }

    /**
     * 실제 강화 값을 적용합니다.
     */
    private async applyPotentiation(activeFile: any, fileContent: string, currentPotentiation: number) {
        // 강화 수행
        const newPotentiation = currentPotentiation + FrontmatterManager.getPotentiationIncrement();
        const now = moment().utcOffset('+09:00');  // 한국 시간대 설정
        const formattedDate = now.format('YYYY-MM-DDTHH:mm:ss');  // ISO 8601 형식으로 변경

        const updatedContent = this.frontmatterManager.updateFrontmatter(fileContent, {
            potentiation: newPotentiation,
            updated: formattedDate
        });

        await this.app.vault.modify(activeFile, updatedContent);
        new Notice(`강화 완료! (${currentPotentiation} → ${newPotentiation})`);
    }
}
