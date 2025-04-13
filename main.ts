import { Plugin, Editor, MarkdownView, TFile, Notice } from 'obsidian';
import { NewNote } from './src/modules/command/create/newNote';
import { LinkNote } from './src/modules/command/create/linkNote';
import { UpdateTags } from './src/modules/command/update/updateTags';
import { Potentiate } from './src/modules/command/update/potentiate';
import { DeleteAttachment } from './src/modules/command/delete/deleteAttachments';
import { DeleteCurrentNote } from './src/modules/command/delete/deleteCurrentNote';
import { DeactivateNotes } from './src/modules/command/move/deactivateNotes';
import { ActivateNotes } from './src/modules/command/move/activateNotes';
import { GraphManager } from './src/modules/maintenance/utils/graph/graphManager';
import { AILSSSettings, DEFAULT_SETTINGS, AILSSSettingTab } from './src/modules/maintenance/settings/settings';
import { AIImageAnalyzer } from './src/modules/ai/image/aiImageAnalyzer';
import { AIAnswer } from './src/modules/ai/text/aiAnswer';
import { AILinkNote } from './src/modules/ai/text/aiLinkNote';
import { AILatexMath } from './src/modules/ai/text/aiLatexMath';
import { AIVisualizer } from './src/modules/ai/text/aiVisualizer';
import { FileCountManager } from './src/modules/maintenance/utils/fileCountManager';
import { UpdateAttachments } from './src/modules/command/update/updateAttachments';
import { IntegrityCheck } from './src/modules/maintenance/utils/integrityCheck';
import { GlobalGraphManager } from './src/modules/maintenance/utils/graph/global/globalGraphManager';
import { RenewNote } from './src/modules/command/move/renewNote';
import { CopyNote } from './src/modules/command/create/copyNote';
import { RecoverNote } from './src/modules/command/create/recoverNote';
import { AIImageCreator } from './src/modules/ai/image/aiImageCreator';
import { AIProcess } from './src/modules/ai/text/aiProcess';
import { AIReformat } from './src/modules/ai/text/aiReformat';
import { UnlinkNotes } from './src/modules/command/update/unlinkNotes';
import { OpenAITTS } from './src/modules/ai/audio/openai_tts';
import { EmbedNote } from './src/modules/command/create/embedNote';
import { AINoteRestructure } from './src/modules/ai/text/aiNoteRestructure';
import { AINoteRefactor } from './src/modules/ai/text/aiNoteRefactor';
import { NoteRefactoringModal } from './src/components/noteRefactoringModal';
import { FrontmatterManager } from './src/modules/maintenance/utils/frontmatterManager';



export default class AILSSPlugin extends Plugin {
	settings: AILSSSettings;
	private newNoteManager: NewNote;
	private linkNoteManager: LinkNote;
	private updateTagsManager: UpdateTags;
	
	private potentiateManager: Potentiate;
	private deleteAttachmentManager: DeleteAttachment;
	private deleteCurrentNoteManager: DeleteCurrentNote;
	
	private deactivateNotesManager: DeactivateNotes;
	private activateNotesManager: ActivateNotes;
	private pendingRename: boolean = false;
	private renameTimeout: number | null = null;
	private graphManager: GraphManager;
	private aiImageAnalyzer: AIImageAnalyzer;
	private aiAnswer: AIAnswer;
	private aiLinkNote: AILinkNote;
	private aiLatexMath: AILatexMath;
	private aiVisualizer: AIVisualizer;
	private fileCountManager: FileCountManager;
	private updateAttachmentsManager: UpdateAttachments;
	private integrityCheck: IntegrityCheck;
	private globalGraphManager: GlobalGraphManager;
	private renewNoteManager: RenewNote;
	private copyNoteManager: CopyNote;
	private recoverNoteManager: RecoverNote;
	private aiImageCreator: AIImageCreator;
	private aiProcess: AIProcess;
	private aiReformat: AIReformat;
	private unlinkNotesManager: UnlinkNotes;
	private embedNoteManager: EmbedNote;
	private aiNoteRestructure: AINoteRestructure;
	noteRefactoringManager: AINoteRefactor;



	async onload() {
		await this.loadSettings();
		this.addSettingTab(new AILSSSettingTab(this.app, this));
		
		this.newNoteManager = new NewNote(this.app, this);
		this.linkNoteManager = new LinkNote(this.app, this);
		this.updateTagsManager = new UpdateTags(this.app, this);
		
		this.potentiateManager = new Potentiate(this.app, this);
		this.deleteAttachmentManager = new DeleteAttachment(this.app, this);
		this.deleteCurrentNoteManager = new DeleteCurrentNote(this.app, this);
		
		this.deactivateNotesManager = new DeactivateNotes(this.app, this);
		this.activateNotesManager = new ActivateNotes(this.app, this);

		// GraphManager 초기화
		this.graphManager = new GraphManager(this.app, this);

		// AI 모듈 초기화
		this.aiImageAnalyzer = new AIImageAnalyzer(this.app, this);
		this.aiAnswer = new AIAnswer(this.app, this);
		this.aiLinkNote = new AILinkNote(this.app, this);
		this.aiLatexMath = new AILatexMath(this.app, this);
		this.aiVisualizer = new AIVisualizer(this.app, this);

		// FileCountManager 초기화
		this.fileCountManager = FileCountManager.getInstance(this.app, this);

		// UpdateAttachments 초기화
		this.updateAttachmentsManager = new UpdateAttachments(this.app, this);

		// IntegrityCheck 초기화
		this.integrityCheck = new IntegrityCheck(this.app, this);

		// GlobalGraphManager 초기화
		this.globalGraphManager = new GlobalGraphManager(this.app, this);

		// RenewNote 초기화
		this.renewNoteManager = new RenewNote(this.app, this);

		// EmbedNote, CopyNote, RecoverNote 초기화
		this.copyNoteManager = new CopyNote(this.app, this);
		this.recoverNoteManager = new RecoverNote(this.app, this);
		this.embedNoteManager = new EmbedNote(this.app, this);

		// AI 이미지 생성기 초기화
		this.aiImageCreator = new AIImageCreator(this);

		// AI Process 초기화
		this.aiProcess = new AIProcess(this.app, this);

		// AI Reformat 초기화
		this.aiReformat = new AIReformat(this.app, this);

		// UnlinkNotes 초기화
		this.unlinkNotesManager = new UnlinkNotes(this.app, this);

		// AI 노트 재구조화 초기화
		this.aiNoteRestructure = new AINoteRestructure(this.app, this);

		// 노트 리팩토링 매니저 초기화
		this.noteRefactoringManager = new AINoteRefactor(this.app, this);

		// 노트 리팩토링 리본 추가
		this.addRibbonIcon('git-graph', '노트 리팩토링', () => {
			NoteRefactoringModal.openForActiveNote(this.app, this);
		});

		// 리본 메뉴 아이콘들 업데이트
		this.addRibbonIcon('plus', '노트 생성', () => {
			this.newNoteManager.createNewNote();
		});

		this.addRibbonIcon('square-plus', '노트 연결', () => {
			this.linkNoteManager.createLinkNote();
		});

		this.addRibbonIcon('delete', '첨부파일 삭제', () => {
			this.deleteAttachmentManager.deleteLink();
		});

		this.addRibbonIcon('tags', '태그 동기화', () => {
			this.updateTagsManager.updateCurrentNoteTags();
		});

		this.addRibbonIcon('zap', '노트 강화', () => {
			this.potentiateManager.potentiateNote();
		});

		this.addRibbonIcon('x', '노트 삭제', () => {
			this.deleteCurrentNoteManager.deleteNote();
		});

		this.addRibbonIcon('heart-off', '노트 비활성화', () => {
			this.deactivateNotesManager.deactivateNotesByTag();
		});

		this.addRibbonIcon('heart-pulse', '노트 활성화', () => {
			this.activateNotesManager.activateNotes();
		});

		this.addRibbonIcon('scan-search', '이미지 분석', () => {
			this.aiImageAnalyzer.main();
		});

		this.addRibbonIcon('messages-square', 'AI 답변', () => {
			this.aiAnswer.main();
		});

		this.addRibbonIcon('dna', 'AI 노트 연결', () => {
			this.aiLinkNote.createAILinkNote();
		});

		this.addRibbonIcon('sigma', 'LaTeX 수식 변환', () => {
			this.aiLatexMath.main();
		});

		this.addRibbonIcon('view', '노트 시각화', () => {
			this.aiVisualizer.main();
		});

		this.addRibbonIcon('folder-sync', '첨부파일 동기화', () => {
			this.updateAttachmentsManager.updateAttachments();
		});

		this.addRibbonIcon('shield-check', '무결성 검사', () => {
			this.integrityCheck.checkIntegrity();
		});

		this.addRibbonIcon('waypoints', '전역 그래프 초기화', () => {
			this.globalGraphManager.applyGlobalGraphConfig();
		});

		this.addRibbonIcon('activity', '노트 갱신', () => {
			this.renewNoteManager.renewCurrentNote();
		});

		this.addRibbonIcon('copy-plus', '노트 복사', () => {
			this.copyNoteManager.createCopyNote();
		});

		this.addRibbonIcon('diamond-plus', '노트 임베드', () => {
			this.embedNoteManager.createEmbedNote();
		});

		this.addRibbonIcon('rotate-ccw', '노트 복구', () => {
			this.recoverNoteManager.recoverNote();
		});

		this.addRibbonIcon('image-plus', 'AI 이미지 생성', () => {
			this.aiImageCreator.main();
		});

		this.addRibbonIcon('terminal', 'AI 명령 처리', () => {
			this.aiProcess.main();
		});

		this.addRibbonIcon('list', '텍스트 재구성', () => {
			this.aiReformat.main();
		});

		this.addRibbonIcon('unlink', '노트 링크 해제', () => {
			this.unlinkNotesManager.unlinkSelectedNotes();
		});

		// 노트 재구조화 리본 메뉴 추가
		this.addRibbonIcon('boxes', '노트 채우기', () => {
			this.aiNoteRestructure.main();
		});

		// TTS 리본 메뉴 추가
		this.addRibbonIcon('mic', 'TTS 변환', () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view && view.editor) {
				const tts = new OpenAITTS(this);
				tts.convertTextToSpeech(view.editor);
			}
		});

		// 명령어 추가
		this.addCommand({
			id: 'create-neuron',
			name: '노트 생성',
			icon: 'plus',
			callback: () => this.newNoteManager.createNewNote()
		});

		this.addCommand({
			id: 'connect-neuron',
			name: '노트 연결',
			icon: 'square-plus',
			editorCallback: () => this.linkNoteManager.createLinkNote()
		});

		this.addCommand({
			id: 'sync-neuron-tags',
			name: '태그 동기화',
			icon: 'tags',
			callback: () => this.updateTagsManager.updateCurrentNoteTags()
		});

		this.addCommand({
			id: 'strengthen-neuron',
			name: '노트 강화',
			icon: 'zap',
			callback: () => this.potentiateManager.potentiateNote()
		});

		this.addCommand({
			id: 'delete-neuron',
			name: '노트 삭제',
			icon: 'x',
			callback: () => this.deleteCurrentNoteManager.deleteNote()
		});

		this.addCommand({
			id: 'deactivate-neuron',
			name: '노트 비활성화',
			icon: 'heart-off',
			callback: () => this.deactivateNotesManager.deactivateNotesByTag()
		});

		this.addCommand({
			id: 'activate-neuron',
			name: '노트 활성화',
			icon: 'heart-pulse',
			callback: () => this.activateNotesManager.activateNotes()
		});

		this.addCommand({
			id: 'run-image-analyzer',
			name: '이미지 분석',
			icon: 'scan-search',
			editorCallback: () => this.aiImageAnalyzer.main()
		});

		this.addCommand({
			id: 'generate-ai-answer',
			name: 'AI 답변',
			icon: 'messages-square',
			editorCallback: () => this.aiAnswer.main()
		});

		this.addCommand({
			id: 'connect-ai-neuron',
			name: 'AI 노트 연결',
			icon: 'dna',
			editorCallback: () => this.aiLinkNote.createAILinkNote()
		});

		this.addCommand({
			id: 'convert-latex',
			name: 'LaTeX 수식 변환',
			icon: 'sigma',
			editorCallback: () => this.aiLatexMath.main()
		});

		this.addCommand({
			id: 'visualize-neuron',
			name: '노트 시각화',
			icon: 'view',
			editorCallback: () => this.aiVisualizer.main()
		});

		this.addCommand({
			id: 'sync-attachments',
			name: '첨부파일 동기화',
			icon: 'folder-sync',
			callback: () => this.updateAttachmentsManager.updateAttachments()
		});

		this.addCommand({
			id: 'check-neural-network',
			name: '무결성 검사',
			icon: 'shield-check',
			callback: () => this.integrityCheck.checkIntegrity()
		});

		this.addCommand({
			id: 'configure-global-network',
			name: '전역 그래프 초기화',
			icon: 'waypoints',
			callback: () => this.globalGraphManager.applyGlobalGraphConfig()
		});

		this.addCommand({
			id: 'refresh-neuron',
			name: '노트 갱신',
			icon: 'activity',
			callback: () => this.renewNoteManager.renewCurrentNote()
		});

		this.addCommand({
			id: 'embed-note',
			name: '노트 임베드',
			icon: 'diamond-plus',
			editorCallback: () => this.embedNoteManager.createEmbedNote()
		});

		this.addCommand({
			id: 'copy-note',
			name: '노트 복사',
			icon: 'copy-plus',
			editorCallback: () => this.copyNoteManager.createCopyNote()
		});

		this.addCommand({
			id: 'recover-note',
			name: '노트 복구',
			icon: 'rotate-ccw',
			editorCallback: () => this.recoverNoteManager.recoverNote()
		});

		this.addCommand({
			id: 'delete-attachment',
			name: '첨부파일 삭제',
			icon: 'delete',
			editorCallback: () => this.deleteAttachmentManager.deleteLink()
		});

		this.addCommand({
			id: 'generate-ai-image',
			name: 'AI 이미지 생성',
			icon: 'image-plus',
			editorCallback: () => this.aiImageCreator.main()
		});

		this.addCommand({
			id: 'process-ai-command',
			name: 'AI 명령 처리',
			icon: 'terminal',
			editorCallback: () => this.aiProcess.main()
		});

		this.addCommand({
			id: 'reformat-text',
			name: '텍스트 재구성',
			icon: 'list',
			editorCallback: () => this.aiReformat.main()
		});

		this.addCommand({
			id: 'unlink-notes',
			name: '노트 링크 해제',
			icon: 'unlink',
			editorCallback: () => this.unlinkNotesManager.unlinkSelectedNotes()
		});

		// 노트 리팩토링 명령 추가
		this.addCommand({
			id: 'note-refactoring',
			name: '노트 리팩토링',
			icon: 'git-graph',
			callback: () => NoteRefactoringModal.openForActiveNote(this.app, this)
		});

		// 노트 재구조화 명령 추가
		this.addCommand({
			id: 'restructure-note',
			name: '노트 채우기',
			icon: 'boxes',
			editorCallback: () => this.aiNoteRestructure.main()
		});

		// TTS 명령어 등록 (하나로 통일)
		this.addCommand({
			id: 'convert-text-to-speech',
			name: 'TTS 변환',
			icon: 'mic',
			editorCallback: (editor: Editor) => {
				const tts = new OpenAITTS(this);
				tts.convertTextToSpeech(editor);
			}
		});
	}


	onunload() {
		if (this.renameTimeout) {
			window.clearTimeout(this.renameTimeout);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
