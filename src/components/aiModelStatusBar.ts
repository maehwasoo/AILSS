import { App, Notice, Plugin } from 'obsidian';
import { AILSSSettings, OPENAI_MODELS, CLAUDE_MODELS, PERPLEXITY_MODELS, GOOGLE_MODELS } from '../modules/maintenance/settings/settings';

export class AIModelStatusBar {
    private aiModelStatusBarItem: HTMLElement;
    private aiModelDropdown: HTMLElement;
    private aiModelDropdownVisible = false;
    private plugin: Plugin;
    private app: App;
    private settings: AILSSSettings;

    constructor(app: App, plugin: Plugin, settings: AILSSSettings) {
        this.app = app;
        this.plugin = plugin;
        this.settings = settings;
    }

    /**
     * 상태 표시줄에 AI 모델 선택기 초기화 및 추가
     */
    public init(): void {
        // 상태 표시줄 추가
        this.addAIModelStatusBarItem();
    }

    /**
     * 상태 표시줄에 AI 모델 선택기 추가하는 함수
     */
    private addAIModelStatusBarItem(): void {
        // 상태 표시줄 아이템 생성
        this.aiModelStatusBarItem = this.plugin.addStatusBarItem();
        this.aiModelStatusBarItem.addClass('ailss-ai-model-status');
        
        // 현재 선택된 모델 표시
        this.updateAIModelStatusBar();
        
        // 클릭 이벤트 처리
        this.aiModelStatusBarItem.onClickEvent((evt: MouseEvent) => {
            evt.preventDefault();
            if (this.aiModelDropdownVisible) {
                this.hideAIModelDropdown();
            } else {
                this.showAIModelDropdown();
            }
        });
        
        // 문서 클릭 시 드롭다운 숨기기
        document.addEventListener('click', (evt: MouseEvent) => {
            if (this.aiModelDropdownVisible && !this.aiModelStatusBarItem.contains(evt.target as Node) && 
                (!this.aiModelDropdown || !this.aiModelDropdown.contains(evt.target as Node))) {
                this.hideAIModelDropdown();
            }
        });
    }
    
    /**
     * 상태 표시줄 업데이트 함수
     */
    private updateAIModelStatusBar(): void {
        const modelName = this.getSelectedModelName();
        this.aiModelStatusBarItem.setText(`${modelName}`);
        this.aiModelStatusBarItem.setAttr('aria-label', `현재 AI 모델: ${modelName}. 클릭하여 변경`);
    }
    
    /**
     * 현재 선택된 모델명 가져오기
     */
    private getSelectedModelName(): string {
        const { selectedAIModel } = this.settings;
        
        switch (selectedAIModel) {
            case 'openai':
                return `OpenAI (${this.settings.openAIModel})`;
            case 'claude':
                return `Claude (${this.settings.claudeModel})`;
            case 'perplexity':
                return `Perplexity (${this.settings.perplexityModel})`;
            case 'google':
                return `Google AI (${this.settings.googleAIModel})`;
            default:
                return selectedAIModel;
        }
    }
    
    /**
     * AI 모델 드롭다운 메뉴 표시
     */
    private showAIModelDropdown(): void {
        // 이미 열려있으면 닫기
        if (this.aiModelDropdownVisible) {
            this.hideAIModelDropdown();
            return;
        }
        
        // 드롭다운 생성
        this.aiModelDropdown = document.createElement('div');
        this.aiModelDropdown.addClass('ailss-ai-model-dropdown');
        
        // AI 제공자 리스트 생성
        this.createAIProviderOptions();
        
        // 현재 선택된 제공자의 모델 옵션 표시
        this.showSelectedProviderModels();
        
        // 드롭다운 추가
        document.body.appendChild(this.aiModelDropdown);
        
        // 드롭다운 위치 조정 (오른쪽 경계를 상태바에 맞춤)
        const rect = this.aiModelStatusBarItem.getBoundingClientRect();
        
        this.aiModelDropdown.style.position = 'absolute';
        this.aiModelDropdown.style.bottom = (window.innerHeight - rect.top) + 'px';
        this.aiModelDropdown.style.right = (window.innerWidth - rect.right) + 'px';
        
        this.aiModelDropdownVisible = true;
    }
    
    /**
     * AI 제공자 옵션 생성
     */
    private createAIProviderOptions(): void {
        const providers = [
            { id: 'openai', name: 'OpenAI' },
            { id: 'claude', name: 'Claude' },
            { id: 'perplexity', name: 'Perplexity' },
            { id: 'google', name: 'Google AI' }
        ];
        
        const providerSection = document.createElement('div');
        providerSection.addClass('ailss-provider-section');
        
        for (const provider of providers) {
            const providerOption = document.createElement('div');
            providerOption.addClass('ailss-provider-option');
            
            if (provider.id === this.settings.selectedAIModel) {
                providerOption.addClass('ailss-selected-provider');
            }
            
            providerOption.setText(provider.name);
            providerOption.onClickEvent(async () => {
                this.settings.selectedAIModel = provider.id as any;
                await this.plugin.saveData(this.settings);
                this.updateAIModelStatusBar();
                this.hideAIModelDropdown();
                new Notice(`AI 제공자가 ${provider.name}로 변경되었습니다`);
            });
            
            providerSection.appendChild(providerOption);
        }
        
        this.aiModelDropdown.appendChild(providerSection);
    }
    
    /**
     * 선택된 제공자의 모델 옵션 표시
     */
    private showSelectedProviderModels(): void {
        const modelSection = document.createElement('div');
        modelSection.addClass('ailss-model-section');
        
        let models: { id: string, name: string }[] = [];
        let currentModelKey = '';
        
        // 선택된 제공자에 따라 모델 리스트 설정
        switch (this.settings.selectedAIModel) {
            case 'openai':
                models = OPENAI_MODELS;
                currentModelKey = 'openAIModel';
                break;
            case 'claude':
                models = CLAUDE_MODELS;
                currentModelKey = 'claudeModel';
                break;
            case 'perplexity':
                models = PERPLEXITY_MODELS;
                currentModelKey = 'perplexityModel';
                break;
            case 'google':
                models = GOOGLE_MODELS;
                currentModelKey = 'googleAIModel';
                break;
        }
        
        // 모델 옵션 추가
        for (const model of models) {
            const modelOption = document.createElement('div');
            modelOption.addClass('ailss-model-option');
            
            // 타입 안전한 방식으로 모델 비교
            const selectedModel = this.getModelValueByKey(currentModelKey);
            if (model.id === selectedModel) {
                modelOption.addClass('ailss-selected-model');
            }
            
            modelOption.setText(model.name);
            modelOption.onClickEvent(async () => {
                // 타입 안전한 방식으로 모델 설정
                this.setModelValueByKey(currentModelKey, model.id);
                await this.plugin.saveData(this.settings);
                this.updateAIModelStatusBar();
                this.hideAIModelDropdown();
                new Notice(`${this.settings.selectedAIModel} 모델이 ${model.name}로 변경되었습니다`);
            });
            
            modelSection.appendChild(modelOption);
        }
        
        this.aiModelDropdown.appendChild(modelSection);
    }
    
    /**
     * 모델 키에 따라 설정 값을 안전하게 가져오는 헬퍼 메서드
     */
    private getModelValueByKey(key: string): string {
        switch (key) {
            case 'openAIModel':
                return this.settings.openAIModel;
            case 'claudeModel':
                return this.settings.claudeModel;
            case 'perplexityModel':
                return this.settings.perplexityModel;
            case 'googleAIModel':
                return this.settings.googleAIModel;
            default:
                return '';
        }
    }
    
    /**
     * 모델 키에 따라 설정 값을 안전하게 설정하는 헬퍼 메서드
     */
    private setModelValueByKey(key: string, value: string): void {
        switch (key) {
            case 'openAIModel':
                this.settings.openAIModel = value;
                break;
            case 'claudeModel':
                this.settings.claudeModel = value;
                break;
            case 'perplexityModel':
                this.settings.perplexityModel = value;
                break;
            case 'googleAIModel':
                this.settings.googleAIModel = value;
                break;
        }
    }
    
    /**
     * 드롭다운 숨기기
     */
    private hideAIModelDropdown(): void {
        if (this.aiModelDropdown && this.aiModelDropdown.parentNode) {
            this.aiModelDropdown.parentNode.removeChild(this.aiModelDropdown);
        }
        this.aiModelDropdownVisible = false;
    }

    /**
     * 메모리 정리 및 이벤트 리스너 제거
     */
    public unload(): void {
        if (this.aiModelDropdown && this.aiModelDropdown.parentNode) {
            this.aiModelDropdown.parentNode.removeChild(this.aiModelDropdown);
        }
    }
}