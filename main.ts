import { Plugin } from 'obsidian';
import { AILSSSettings, DEFAULT_SETTINGS, AILSSSettingTab } from './src/core/settings/settings';
import { ServiceRegistry } from './src/core/serviceRegistry';
import { CommandRegistry } from './src/core/commandRegistry';
import { RibbonRegistry } from './src/core/ribbonRegistry';
import { AIModelStatusBar } from './src/components/statusBarUI/aiModelStatusBar';
import { AINoteRefactor } from './src/modules/ai/text/aiNoteRefactor';

export default class AILSSPlugin extends Plugin {
	settings: AILSSSettings;
	
	// 핵심 레지스트리 객체들
	private serviceRegistry: ServiceRegistry;
	private commandRegistry: CommandRegistry;
	private ribbonRegistry: RibbonRegistry;
	
	// 직접 접근이 필요한 일부 서비스/상태 변수
	noteRefactoringManager: AINoteRefactor;
	private pendingRename: boolean = false;
	private renameTimeout: number | null = null;

	// AI 모델 상태 표시줄 관리자
	private aiModelStatusBar: AIModelStatusBar;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new AILSSSettingTab(this.app, this));
		
		// 서비스 레지스트리 초기화 및 모든 서비스 생성
		this.serviceRegistry = new ServiceRegistry(this.app, this);
		this.serviceRegistry.initializeAllServices();
		
		// 직접 접근이 필요한 서비스 참조
		this.noteRefactoringManager = this.serviceRegistry.getNoteRefactoringManager();
		
		// 명령어와 리본 메뉴 레지스트리 초기화
		this.commandRegistry = new CommandRegistry(this, this.serviceRegistry);
		this.ribbonRegistry = new RibbonRegistry(this, this.serviceRegistry);
		
		// 명령어와 리본 메뉴 등록
		this.commandRegistry.registerAllCommands();
		this.ribbonRegistry.addAllRibbonIcons();
		
		// AI 모델 상태 표시줄 초기화
		this.aiModelStatusBar = new AIModelStatusBar(this.app, this, this.settings);
		this.aiModelStatusBar.init();
	}

	onunload() {
		if (this.renameTimeout) {
			window.clearTimeout(this.renameTimeout);
		}
		
		// AI 모델 상태 표시줄 정리
		if (this.aiModelStatusBar) {
			this.aiModelStatusBar.unload();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// 설정이 변경될 때마다 상태 표시줄 업데이트
		if (this.aiModelStatusBar) {
			this.aiModelStatusBar.updateStatus();
		}
	}
}
