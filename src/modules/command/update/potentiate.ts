import { App, Notice } from 'obsidian';
import type AILSSPlugin from '../../../../main';
import { FrontmatterManager } from '../../../core/utils/frontmatterManager';
import { showConfirmationDialog } from '../../../components/commonUI/confirmationModal';
import { moment } from 'obsidian';

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