import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { FileCountManager } from '../utils/fileCountManager';
import { PathSettings } from './pathSettings';

export interface AILSSSettings {
    openAIAPIKey: string;
    claudeAPIKey: string;
    perplexityAPIKey: string;
    selectedAIModel: 'openai' | 'claude' | 'perplexity';
    selectedVisionModel: 'claude' | 'openai';
    openAIModel: string;
    claudeModel: string;
    perplexityModel: string;
    dalleModel: 'dall-e-2' | 'dall-e-3';
    ttsModel: 'tts-1' | 'tts-1-hd';
    ttsVoice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
    convertSelectionToLink: boolean;
}

export const DEFAULT_SETTINGS: AILSSSettings = {
    openAIAPIKey: '',
    claudeAPIKey: '',
    perplexityAPIKey: '',
    selectedAIModel: 'claude',
    selectedVisionModel: 'claude',
    openAIModel: 'gpt-4o',
    claudeModel: 'claude-3-5-sonnet-20241022',
    perplexityModel: 'sonar-pro',
    dalleModel: 'dall-e-3',
    ttsModel: 'tts-1-hd',
    ttsVoice: 'nova',
    convertSelectionToLink: true,
};

export class AILSSSettingTab extends PluginSettingTab {
    plugin: AILSSPlugin;

    constructor(app: App, plugin: AILSSPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h1', { text: 'AILSS' });

        // 통계 섹션
        containerEl.createEl('h2', { text: '통계' });
        const statisticsContainer = containerEl.createDiv('statistics-section');
        this.addStatistics(statisticsContainer);

        // AI 설정 섹션
        containerEl.createEl('h2', { text: 'AI 모델 설정' });
        const aiSettingsContainer = containerEl.createDiv('ai-settings-section');
        this.addAISettings(aiSettingsContainer);

        // API 설정 섹션
        containerEl.createEl('h2', { text: 'API 설정' });
        const apiSettingsContainer = containerEl.createDiv('api-settings-section');
        this.addAPISettings(apiSettingsContainer);
    }

    private async addStatistics(containerEl: HTMLElement) {
        const fileCountManager = FileCountManager.getInstance(this.app, this.plugin);
        const noteCount = await fileCountManager.getNoteCount();
        const attachmentCount = await fileCountManager.getAttachmentCount();
        
        // 통계 정보 표시
        new Setting(containerEl)
            .setName('전체 노트 수')
            .setDesc(`노트 개수는 최대 ${PathSettings.MAX_NOTES}개로 제한됩니다`)
            .addText(text => text
                .setValue(String(noteCount))
                .setDisabled(true));

        new Setting(containerEl)
            .setName('전체 첨부파일 수')
            .setDesc('날짜별 경로에 저장된 총 첨부파일 개수')
            .addText(text => text
                .setValue(String(attachmentCount))
                .setDisabled(true));

        containerEl.createEl('hr');
    }

    private addAISettings(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName('AI 모델 선택')
            .setDesc('사용할 AI 모델을 선택하세요')
            .addDropdown(dropdown => dropdown
                .addOption('openai', 'OpenAI')
                .addOption('claude', 'Claude')
                .addOption('perplexity', 'Perplexity')
                .setValue(this.plugin.settings.selectedAIModel)
                .onChange(async (value: 'openai' | 'claude' | 'perplexity') => {
                    this.plugin.settings.selectedAIModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Vision 모델 선택')
            .setDesc('이미지 분석에 사용할 AI 모델을 선택하세요')
            .addDropdown(dropdown => dropdown
                .addOption('claude', 'Claude Vision')
                .addOption('openai', 'GPT-4 Vision')
                .setValue(this.plugin.settings.selectedVisionModel)
                .onChange(async (value: 'claude' | 'openai') => {
                    this.plugin.settings.selectedVisionModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('DALL-E 모델')
            .setDesc('이미지 생성에 사용할 DALL-E 모델을 선택하세요')
            .addDropdown(dropdown => dropdown
                .addOption('dall-e-2', 'DALL-E 2')
                .addOption('dall-e-3', 'DALL-E 3')
                .setValue(this.plugin.settings.dalleModel)
                .onChange(async (value: 'dall-e-2' | 'dall-e-3') => {
                    this.plugin.settings.dalleModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('TTS 모델')
            .setDesc('음성 합성에 사용할 TTS 모델을 선택하세요')
            .addDropdown(dropdown => dropdown
                .addOption('tts-1', 'TTS-1 (표준)')
                .addOption('tts-1-hd', 'TTS-1-HD (고품질)')
                .setValue(this.plugin.settings.ttsModel)
                .onChange(async (value: 'tts-1' | 'tts-1-hd') => {
                    this.plugin.settings.ttsModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('TTS 음성')
            .setDesc('기본 음성 타입을 선택하세요')
            .addDropdown(dropdown => dropdown
                .addOption('alloy', 'Alloy')
                .addOption('echo', 'Echo')
                .addOption('fable', 'Fable')
                .addOption('onyx', 'Onyx')
                .addOption('nova', 'Nova')
                .addOption('shimmer', 'Shimmer')
                .setValue(this.plugin.settings.ttsVoice)
                .onChange(async (value: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer') => {
                    this.plugin.settings.ttsVoice = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('선택 텍스트를 링크로 변환')
            .setDesc('AI 노트 연결 시 선택한 텍스트를 링크로 변환할지 설정합니다')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.convertSelectionToLink)
                .onChange(async (value) => {
                    this.plugin.settings.convertSelectionToLink = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('hr');
    }

    private addAPISettings(containerEl: HTMLElement) {
        this.addMaskedApiKeySetting(containerEl, 'OpenAI API Key', 'openAIAPIKey');
        new Setting(containerEl)
            .setName('OpenAI 모델')
            .setDesc('사용할 OpenAI 모델을 선택하세요')
            .addDropdown(dropdown => dropdown
                .addOption('gpt-4o', 'GPT-4o')
                .addOption('gpt-4.5-preview', 'GPT-4.5 Preview')
                .addOption('gpt-4o-mini', 'GPT-4o mini')
                .addOption('o1-mini', 'o1-mini')
                .addOption('o3-mini', 'o3-mini')
                .addOption('o1', 'o1')
                .setValue(this.plugin.settings.openAIModel)
                .onChange(async (value) => {
                    this.plugin.settings.openAIModel = value;
                    await this.plugin.saveSettings();
                }));

        this.addMaskedApiKeySetting(containerEl, 'Claude API Key', 'claudeAPIKey');
        new Setting(containerEl)
            .setName('Claude 모델')
            .setDesc('사용할 Claude 모델을 선택하세요')
            .addDropdown(dropdown => dropdown
                .addOption('claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet')
                .addOption('claude-3-5-haiku-20241022', 'Claude 3.5 Haiku')
                .addOption('claude-3-7-sonnet-20250219', 'Claude 3.7 Sonnet')
                .setValue(this.plugin.settings.claudeModel)
                .onChange(async (value) => {
                    this.plugin.settings.claudeModel = value;
                    await this.plugin.saveSettings();
                }));

        this.addMaskedApiKeySetting(containerEl, 'Perplexity API Key', 'perplexityAPIKey');
        new Setting(containerEl)
            .setName('Perplexity 모델')
            .setDesc('사용할 Perplexity 모델을 선택하세요')
            .addDropdown(dropdown => dropdown
                .addOption('sonar-reasoning-pro', 'Sonar Reasoning Pro')
                .addOption('sonar-reasoning', 'Sonar Reasoning')
                .addOption('sonar-pro', 'Sonar Pro')
                .addOption('sonar', 'Sonar')
                .setValue(this.plugin.settings.perplexityModel)
                .onChange(async (value) => {
                    this.plugin.settings.perplexityModel = value;
                    await this.plugin.saveSettings();
                }));
    }

    private addMaskedApiKeySetting(containerEl: HTMLElement, name: string, settingKey: keyof AILSSSettings & string) {
        new Setting(containerEl)
            .setName(name)
            .setDesc(`${name}를 입력하세요`)
            .addText(text => text
                .setPlaceholder('새 값 입력')
                .setValue(this.plugin.settings[settingKey] ? '•••••••••••••' : '')
                .onChange(async (value) => {
                    if (value && value !== '•••••••••••••') {
                        if ((settingKey === 'openAIAPIKey' || settingKey === 'claudeAPIKey') && !value.startsWith('sk-')) {
                            new Notice(`유효하지 않은 ${name} 형식입니다. "sk-"로 시작해야 합니다`);
                            return;
                        }
                        (this.plugin.settings[settingKey] as string) = value;
                        await this.plugin.saveSettings();
                        text.setValue('•••••••••••••');
                    }
                }));
    }
}
