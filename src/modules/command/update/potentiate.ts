import { App, Notice } from 'obsidian';
import type AILSSPlugin from '../../../../main';
import { FrontmatterManager } from '../../../core/utils/frontmatterManager';
import { showConfirmationDialog } from '../../../components/commonUI/confirmationModal';
import { moment } from 'obsidian';
import { NoteRecallModal } from '../../../components/potentiateUI/noteRecallModal';
import { AccuracyResult } from '../../../modules/ai/ai_utils/accuracyChecker';

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

        // 정확도 검증 활성화 여부 확인
        if (this.plugin.settings.enablePotentiateAccuracyCheck) {
            // 정확도 검증 활성화 - 노트 복기 모달 표시
            this.showNoteRecallModal(activeFile, fileContent, currentPotentiation);
        } else {
            // 정확도 검증 비활성화 - 기존 로직 실행
            await this.showConfirmationAndPotentiate(activeFile, fileContent, currentPotentiation);
        }
    }

    /**
     * 노트 복기 모달을 표시하고 정확도 검증을 수행합니다.
     */
    private showNoteRecallModal(activeFile: any, fileContent: string, currentPotentiation: number) {
        const modal = new NoteRecallModal(
            this.app,
            fileContent,
            this.plugin.settings,
            async (result: AccuracyResult) => {
                // 정확도 결과에 따라 강화 적용
                if (result.success) {
                    // 75% 이상이면 강화 적용
                    await this.applyPotentiation(activeFile, fileContent, currentPotentiation);
                    new Notice(`정확도 ${Math.round(result.score)}% - 강화가 적용되었습니다!`, 4000);
                } else {
                    // 75% 미만이면 강화 미적용
                    new Notice(`정확도 ${Math.round(result.score)}% - 75% 이상 필요합니다. 강화가 적용되지 않았습니다.`, 4000);
                    if (result.feedback) {
                        setTimeout(() => {
                            new Notice(`피드백: ${result.feedback}`, 6000);
                        }, 1500);
                    }
                }
            }
        );
        
        modal.open();
    }

    /**
     * 확인 대화상자를 표시하고 강화를 적용합니다.
     */
    private async showConfirmationAndPotentiate(activeFile: any, fileContent: string, currentPotentiation: number) {
        // 사용자 확인 추가
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

        // 강화 적용
        await this.applyPotentiation(activeFile, fileContent, currentPotentiation);
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