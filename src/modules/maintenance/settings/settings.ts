import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { FileCountManager } from '../utils/fileCountManager';
import { PathSettings } from './pathSettings';

// AI 제공자별 모델 리스트 정의
export interface AIModelOption {
    id: string;
    name: string;
}

export const OPENAI_MODELS: AIModelOption[] = [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4.5-preview', name: 'GPT-4.5 Preview' },
    { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
    { id: 'o1-mini', name: 'o1-mini' },
    { id: 'o3-mini', name: 'o3-mini' },
    { id: 'o1', name: 'o1' },
    { id: 'o1-pro', name: 'o1-pro' },
    { id: 'gpt-4o-search-preview', name: 'GPT-4o Search Preview' },
    { id: 'gpt-4o-mini-search-preview', name: 'GPT-4o Mini Search Preview' },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1', name: 'GPT-4.1' },
    { id: 'o4-mini', name: 'o4-mini' }
];

export const CLAUDE_MODELS: AIModelOption[] = [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
    { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet' }
];

export const PERPLEXITY_MODELS: AIModelOption[] = [
    { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro' },
    { id: 'sonar-reasoning', name: 'Sonar Reasoning' },
    { id: 'sonar-pro', name: 'Sonar Pro' },
    { id: 'sonar', name: 'Sonar' }
];

export const GOOGLE_MODELS: AIModelOption[] = [
    { id: 'gemini-2.5-pro-preview-03-25', name: 'Gemini 2.5 Pro Preview' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }
];

export const VISION_MODELS: AIModelOption[] = [
    // OpenAI 비전 모델
    { id: 'o4-mini', name: 'o4 Mini Vision' },
    { id: 'gpt-4.1', name: 'GPT-4.1 Vision' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini Vision' },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano Vision' },
    { id: 'gpt-4o', name: 'GPT-4o Vision' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini Vision' },
    { id: 'o1-pro', name: 'o1 Pro Vision' },
    { id: 'o1', name: 'o1 Vision' },
    { id: 'o3', name: 'o3 Vision' },
    
    // Claude 비전 모델
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet Vision' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku Vision' },
    { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet Vision' },
    
    // Google 비전 모델
    { id: 'gemini-2.5-pro-preview-03-25', name: 'Gemini 2.5 Pro Preview Vision' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash Vision' },
    { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite Vision' }
];

export interface AILSSSettings {
    openAIAPIKey: string;
    claudeAPIKey: string;
    perplexityAPIKey: string;
    googleAIAPIKey: string;
    selectedAIModel: 'openai' | 'claude' | 'perplexity' | 'google';
    visionModel: string; // 새로운 Vision 모델 세부 선택 설정
    openAIModel: string;
    claudeModel: string;
    perplexityModel: string;
    googleAIModel: string;
    imageGenerationModel: 'dall-e-2' | 'dall-e-3' | 'imagen-3.0-generate-002';
    ttsModel: 'tts-1' | 'tts-1-hd';
    ttsVoice: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable' | 'onyx' | 'nova' | 'sage' | 'shimmer' | 'verse';
    convertSelectionToLink: boolean;
}

export const DEFAULT_SETTINGS: AILSSSettings = {
    openAIAPIKey: '',
    claudeAPIKey: '',
    perplexityAPIKey: '',
    googleAIAPIKey: '',
    selectedAIModel: 'claude',
    visionModel: 'claude-3-5-sonnet-20241022', // 기본값은 Claude 3.5 Sonnet Vision
    openAIModel: 'gpt-4o',
    claudeModel: 'claude-3-5-sonnet-20241022',
    perplexityModel: 'sonar-pro',
    googleAIModel: 'gemini-2.5-pro-preview-03-25', 
    imageGenerationModel: 'dall-e-3',
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

    // 드롭다운 너비를 텍스트에 맞게 조정하는 유틸리티 함수
    private adjustDropdownWidth(dropdown: any) {
        if (dropdown.selectEl) {
            dropdown.selectEl.style.width = 'auto';
            dropdown.selectEl.style.minWidth = '200px'; // 최소 너비 설정
            dropdown.selectEl.classList.add('ailss-dropdown');
        }
        return dropdown;
    }

    private addAISettings(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName('AI 모델 선택')
            .setDesc('사용할 AI 모델을 선택하세요')
            .addDropdown(dropdown => this.adjustDropdownWidth(dropdown
                .addOption('openai', 'OpenAI')
                .addOption('claude', 'Claude')
                .addOption('perplexity', 'Perplexity')
                .addOption('google', 'Google AI') 
                .setValue(this.plugin.settings.selectedAIModel)
                .onChange(async (value: 'openai' | 'claude' | 'perplexity' | 'google') => {
                    this.plugin.settings.selectedAIModel = value;
                    await this.plugin.saveSettings();
                })));

        new Setting(containerEl)
            .setName('Vision 모델')
            .setDesc('이미지 분석에 사용할 비전 모델을 직접 선택하세요')
            .addDropdown(dropdown => this.adjustDropdownWidth(dropdown
                .addOptions(VISION_MODELS.reduce((options, model) => {
                    options[model.id] = model.name;
                    return options;
                }, {} as Record<string, string>))
                .setValue(this.plugin.settings.visionModel)
                .onChange(async (value) => {
                    this.plugin.settings.visionModel = value;
                    await this.plugin.saveSettings();
                })));

        new Setting(containerEl)
            .setName('이미지 생성 모델')
            .setDesc('이미지 생성에 사용할 모델을 선택하세요')
            .addDropdown(dropdown => this.adjustDropdownWidth(dropdown
                .addOption('dall-e-2', 'DALL-E 2')
                .addOption('dall-e-3', 'DALL-E 3')
                .addOption('imagen-3.0-generate-002', 'Google Imagen 3.0 Generate')
                .setValue(this.plugin.settings.imageGenerationModel)
                .onChange(async (value: 'dall-e-2' | 'dall-e-3' | 'imagen-3.0-generate-002') => {
                    this.plugin.settings.imageGenerationModel = value;
                    await this.plugin.saveSettings();
                })));

        new Setting(containerEl)
            .setName('TTS 모델')
            .setDesc('음성 합성에 사용할 TTS 모델을 선택하세요')
            .addDropdown(dropdown => this.adjustDropdownWidth(dropdown
                .addOption('tts-1', 'TTS-1 (표준)')
                .addOption('tts-1-hd', 'TTS-1-HD (고품질)')
                .addOption('gpt-4o-mini-tts', 'GPT-4o Mini TTS')
                .setValue(this.plugin.settings.ttsModel)
                .onChange(async (value: 'tts-1' | 'tts-1-hd') => {
                    this.plugin.settings.ttsModel = value;
                    await this.plugin.saveSettings();
                })));

        new Setting(containerEl)
            .setName('TTS 음성')
            .setDesc('기본 음성 타입을 선택하세요')
            .addDropdown(dropdown => this.adjustDropdownWidth(dropdown
                .addOption('alloy', 'Alloy')
                .addOption('ash', 'Ash')
                .addOption('ballad', 'Ballad')
                .addOption('coral', 'Coral')
                .addOption('echo', 'Echo')
                .addOption('fable', 'Fable')
                .addOption('onyx', 'Onyx')
                .addOption('nova', 'Nova')
                .addOption('sage', 'Sage')
                .addOption('shimmer', 'Shimmer')
                .addOption('verse', 'Verse')
                .setValue(this.plugin.settings.ttsVoice)
                .onChange(async (value: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable' | 'onyx' | 'nova' | 'sage' | 'shimmer' | 'verse') => {
                    this.plugin.settings.ttsVoice = value;
                    await this.plugin.saveSettings();
                })));

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
            .addDropdown(dropdown => this.adjustDropdownWidth(dropdown
                .addOptions(OPENAI_MODELS.reduce((options, model) => {
                    options[model.id] = model.name;
                    return options;
                }, {} as Record<string, string>))
                .setValue(this.plugin.settings.openAIModel)
                .onChange(async (value) => {
                    this.plugin.settings.openAIModel = value;
                    await this.plugin.saveSettings();
                })));

        this.addMaskedApiKeySetting(containerEl, 'Claude API Key', 'claudeAPIKey');
        new Setting(containerEl)
            .setName('Claude 모델')
            .setDesc('사용할 Claude 모델을 선택하세요')
            .addDropdown(dropdown => this.adjustDropdownWidth(dropdown
                .addOptions(CLAUDE_MODELS.reduce((options, model) => {
                    options[model.id] = model.name;
                    return options;
                }, {} as Record<string, string>))
                .setValue(this.plugin.settings.claudeModel)
                .onChange(async (value) => {
                    this.plugin.settings.claudeModel = value;
                    await this.plugin.saveSettings();
                })));

        this.addMaskedApiKeySetting(containerEl, 'Perplexity API Key', 'perplexityAPIKey');
        new Setting(containerEl)
            .setName('Perplexity 모델')
            .setDesc('사용할 Perplexity 모델을 선택하세요')
            .addDropdown(dropdown => this.adjustDropdownWidth(dropdown
                .addOptions(PERPLEXITY_MODELS.reduce((options, model) => {
                    options[model.id] = model.name;
                    return options;
                }, {} as Record<string, string>))
                .setValue(this.plugin.settings.perplexityModel)
                .onChange(async (value) => {
                    this.plugin.settings.perplexityModel = value;
                    await this.plugin.saveSettings();
                })));

        this.addMaskedApiKeySetting(containerEl, 'Google AI API Key', 'googleAIAPIKey');
        new Setting(containerEl)
            .setName('Google AI 모델')
            .setDesc('사용할 Google AI 모델을 선택하세요')
            .addDropdown(dropdown => this.adjustDropdownWidth(dropdown
                .addOptions(GOOGLE_MODELS.reduce((options, model) => {
                    options[model.id] = model.name;
                    return options;
                }, {} as Record<string, string>))
                .setValue(this.plugin.settings.googleAIModel)
                .onChange(async (value) => {
                    this.plugin.settings.googleAIModel = value;
                    await this.plugin.saveSettings();
                })));
    }

    private addMaskedApiKeySetting(containerEl: HTMLElement, name: string, settingKey: keyof AILSSSettings & string) {
        new Setting(containerEl)
            .setName(name)
            .setDesc(`${name}를 입력하세요`)
            .addText(text => text
                .setPlaceholder('새 값 입력')
                .setValue(this.plugin.settings[settingKey] ? '•••••••••••••••••' : '')
                .onChange(async (value) => {
                    if (value && value !== '•••••••••••••••••') {
                        // Google AI API 키는 특정 접두사 요구사항이 없을 수 있으므로, 해당 검증 로직은 제거하거나 수정합니다.
                        // if ((settingKey === 'openAIAPIKey' || settingKey === 'claudeAPIKey') && !value.startsWith('sk-')) {
                        //     new Notice(`유효하지 않은 ${name} 형식입니다. "sk-"로 시작해야 합니다`);
                        //     return;
                        // }
                        (this.plugin.settings[settingKey] as string) = value;
                        await this.plugin.saveSettings();
                        text.setValue('•••••••••••••••••');
                    }
                }));
    }
}
