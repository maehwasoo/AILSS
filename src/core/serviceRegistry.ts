import { App } from 'obsidian';
import AILSSPlugin from '../../main';

// 매니저 클래스들을 가져옵니다
import { NewNote } from '../modules/command/create/newNote';
import { LinkNote } from '../modules/command/create/linkNote';
import { UpdateTags } from '../modules/command/update/updateTags';
import { Potentiate } from '../modules/command/update/potentiate';
import { DeleteAttachment } from '../modules/command/delete/deleteAttachments';
import { DeleteCurrentNote } from '../modules/command/delete/deleteCurrentNote';
import { DeactivateNotes } from '../modules/command/move/deactivateNotes';
import { ActivateNotes } from '../modules/command/move/activateNotes';
import { ExportNotes } from '../modules/command/move/exportNotes';
import { GraphManager } from '../modules/maintenance/utils/graph/graphManager';
import { AIImageAnalyzer } from '../modules/ai/image/aiImageAnalyzer';
import { AIAnswer } from '../modules/ai/text/aiAnswer';
import { AILinkNote } from '../modules/ai/text/aiLinkNote';
import { AILatexMath } from '../modules/ai/text/aiLatexMath';
import { AIVisualizer } from '../modules/ai/text/aiVisualizer';
import { FileCountManager } from '../modules/maintenance/utils/fileCountManager';
import { UpdateAttachments } from '../modules/command/update/updateAttachments';
import { IntegrityCheck } from '../modules/maintenance/utils/integrityCheck';
import { GlobalGraphManager } from '../modules/maintenance/utils/graph/global/globalGraphManager';
import { RenewNote } from '../modules/command/move/renewNote';
import { CopyNote } from '../modules/command/create/copyNote';
import { RecoverNote } from '../modules/command/create/recoverNote';
import { AIImageCreator } from '../modules/ai/image/aiImageCreator';
import { AIProcess } from '../modules/ai/text/aiProcess';
import { AIReformat } from '../modules/ai/text/aiReformat';
import { UnlinkNotes } from '../modules/command/update/unlinkNotes';
import { OpenAITTS } from '../modules/ai/audio/openai_tts';
import { EmbedNote } from '../modules/command/create/embedNote';
import { AINoteRestructure } from '../modules/ai/text/aiNoteRestructure';
import { AINoteRefactor } from '../modules/ai/text/aiNoteRefactor';
import { AITagAliasRefactor } from '../modules/ai/text/aiTagAliasRefactor';
import { DuplicateNote } from '../modules/command/create/duplicateNote';

/**
 * 모든 서비스/매니저 객체를 초기화하고 관리하는 레지스트리
 */
export class ServiceRegistry {
    // 노트 생성 관련 서비스
    private newNoteManager: NewNote;
    private linkNoteManager: LinkNote;
    private copyNoteManager: CopyNote;
    private recoverNoteManager: RecoverNote;
    private embedNoteManager: EmbedNote;
    private duplicateNoteManager: DuplicateNote;
    
    // 노트 업데이트 관련 서비스
    private updateTagsManager: UpdateTags;
    private potentiateManager: Potentiate;
    private updateAttachmentsManager: UpdateAttachments;
    private unlinkNotesManager: UnlinkNotes;
    
    // 노트 삭제 관련 서비스
    private deleteAttachmentManager: DeleteAttachment;
    private deleteCurrentNoteManager: DeleteCurrentNote;
    
    // 노트 이동 관련 서비스
    private deactivateNotesManager: DeactivateNotes;
    private activateNotesManager: ActivateNotes;
    private exportNotesManager: ExportNotes;
    private renewNoteManager: RenewNote;
    
    // 그래프 관련 서비스
    private graphManager: GraphManager;
    private globalGraphManager: GlobalGraphManager;
    
    // AI 관련 서비스
    private aiImageAnalyzer: AIImageAnalyzer;
    private aiAnswer: AIAnswer;
    private aiLinkNote: AILinkNote;
    private aiLatexMath: AILatexMath;
    private aiVisualizer: AIVisualizer;
    private aiImageCreator: AIImageCreator;
    private aiProcess: AIProcess;
    private aiReformat: AIReformat;
    private aiNoteRestructure: AINoteRestructure;
    private aiTagAliasRefactor: AITagAliasRefactor;
    
    // 기타 유틸리티
    private fileCountManager: FileCountManager;
    private integrityCheck: IntegrityCheck;
    
    // 특별한 서비스
    public noteRefactoringManager: AINoteRefactor;

    // 일부 상태 관리 변수
    private pendingRename: boolean = false;
    private renameTimeout: number | null = null;
    
    constructor(private app: App, private plugin: AILSSPlugin) {}
    
    /**
     * 모든 서비스 초기화
     */
    public initializeAllServices() {
        this.initializeNoteCreationServices();
        this.initializeNoteUpdateServices();
        this.initializeNoteDeletionServices();
        this.initializeNoteMoveServices();
        this.initializeGraphServices();
        this.initializeAIServices();
        this.initializeUtilityServices();
    }
    
    /**
     * 노트 생성 관련 서비스 초기화
     */
    private initializeNoteCreationServices() {
        this.newNoteManager = new NewNote(this.app, this.plugin);
        this.linkNoteManager = new LinkNote(this.app, this.plugin);
        this.copyNoteManager = new CopyNote(this.app, this.plugin);
        this.recoverNoteManager = new RecoverNote(this.app, this.plugin);
        this.embedNoteManager = new EmbedNote(this.app, this.plugin);
        this.duplicateNoteManager = new DuplicateNote(this.app, this.plugin);
    }
    
    /**
     * 노트 업데이트 관련 서비스 초기화
     */
    private initializeNoteUpdateServices() {
        this.updateTagsManager = new UpdateTags(this.app, this.plugin);
        this.potentiateManager = new Potentiate(this.app, this.plugin);
        this.updateAttachmentsManager = new UpdateAttachments(this.app, this.plugin);
        this.unlinkNotesManager = new UnlinkNotes(this.app, this.plugin);
    }
    
    /**
     * 노트 삭제 관련 서비스 초기화
     */
    private initializeNoteDeletionServices() {
        this.deleteAttachmentManager = new DeleteAttachment(this.app, this.plugin);
        this.deleteCurrentNoteManager = new DeleteCurrentNote(this.app, this.plugin);
    }
    
    /**
     * 노트 이동 관련 서비스 초기화
     */
    private initializeNoteMoveServices() {
        this.deactivateNotesManager = new DeactivateNotes(this.app, this.plugin);
        this.activateNotesManager = new ActivateNotes(this.app, this.plugin);
        this.exportNotesManager = new ExportNotes(this.app, this.plugin);
        this.renewNoteManager = new RenewNote(this.app, this.plugin);
    }
    
    /**
     * 그래프 관련 서비스 초기화
     */
    private initializeGraphServices() {
        this.graphManager = new GraphManager(this.app, this.plugin);
        this.globalGraphManager = new GlobalGraphManager(this.app, this.plugin);
    }
    
    /**
     * AI 관련 서비스 초기화
     */
    private initializeAIServices() {
        this.aiImageAnalyzer = new AIImageAnalyzer(this.app, this.plugin);
        this.aiAnswer = new AIAnswer(this.app, this.plugin);
        this.aiLinkNote = new AILinkNote(this.app, this.plugin);
        this.aiLatexMath = new AILatexMath(this.app, this.plugin);
        this.aiVisualizer = new AIVisualizer(this.app, this.plugin);
        this.aiImageCreator = new AIImageCreator(this.plugin);
        this.aiProcess = new AIProcess(this.app, this.plugin);
        this.aiReformat = new AIReformat(this.app, this.plugin);
        this.aiNoteRestructure = new AINoteRestructure(this.app, this.plugin);
        this.noteRefactoringManager = new AINoteRefactor(this.app, this.plugin);
        this.aiTagAliasRefactor = new AITagAliasRefactor(this.app, this.plugin);
    }
    
    /**
     * 유틸리티 서비스 초기화
     */
    private initializeUtilityServices() {
        this.fileCountManager = FileCountManager.getInstance(this.app, this.plugin);
        this.integrityCheck = new IntegrityCheck(this.app, this.plugin);
    }
    
    // 게터 메소드들 - 노트 생성 관련
    public getNewNoteManager(): NewNote {
        return this.newNoteManager;
    }
    
    public getLinkNoteManager(): LinkNote {
        return this.linkNoteManager;
    }
    
    public getCopyNoteManager(): CopyNote {
        return this.copyNoteManager;
    }
    
    public getRecoverNoteManager(): RecoverNote {
        return this.recoverNoteManager;
    }
    
    public getEmbedNoteManager(): EmbedNote {
        return this.embedNoteManager;
    }
    
    public getDuplicateNoteManager(): DuplicateNote {
        return this.duplicateNoteManager;
    }
    
    // 게터 메소드들 - 노트 업데이트 관련
    public getUpdateTagsManager(): UpdateTags {
        return this.updateTagsManager;
    }
    
    public getPotentiateManager(): Potentiate {
        return this.potentiateManager;
    }
    
    public getUpdateAttachmentsManager(): UpdateAttachments {
        return this.updateAttachmentsManager;
    }
    
    public getUnlinkNotesManager(): UnlinkNotes {
        return this.unlinkNotesManager;
    }
    
    // 게터 메소드들 - 노트 삭제 관련
    public getDeleteAttachmentManager(): DeleteAttachment {
        return this.deleteAttachmentManager;
    }
    
    public getDeleteCurrentNoteManager(): DeleteCurrentNote {
        return this.deleteCurrentNoteManager;
    }
    
    // 게터 메소드들 - 노트 이동 관련
    public getDeactivateNotesManager(): DeactivateNotes {
        return this.deactivateNotesManager;
    }
    
    public getActivateNotesManager(): ActivateNotes {
        return this.activateNotesManager;
    }
    
    public getExportNotesManager(): ExportNotes {
        return this.exportNotesManager;
    }
    
    public getRenewNoteManager(): RenewNote {
        return this.renewNoteManager;
    }
    
    // 게터 메소드들 - 그래프 관련
    public getGraphManager(): GraphManager {
        return this.graphManager;
    }
    
    public getGlobalGraphManager(): GlobalGraphManager {
        return this.globalGraphManager;
    }
    
    // 게터 메소드들 - AI 관련
    public getAIImageAnalyzer(): AIImageAnalyzer {
        return this.aiImageAnalyzer;
    }
    
    public getAIAnswer(): AIAnswer {
        return this.aiAnswer;
    }
    
    public getAILinkNote(): AILinkNote {
        return this.aiLinkNote;
    }
    
    public getAILatexMath(): AILatexMath {
        return this.aiLatexMath;
    }
    
    public getAIVisualizer(): AIVisualizer {
        return this.aiVisualizer;
    }
    
    public getAIImageCreator(): AIImageCreator {
        return this.aiImageCreator;
    }
    
    public getAIProcess(): AIProcess {
        return this.aiProcess;
    }
    
    public getAIReformat(): AIReformat {
        return this.aiReformat;
    }
    
    public getAINoteRestructure(): AINoteRestructure {
        return this.aiNoteRestructure;
    }
    
    public getNoteRefactoringManager(): AINoteRefactor {
        return this.noteRefactoringManager;
    }
    
    public getAITagAliasRefactor(): AITagAliasRefactor {
        return this.aiTagAliasRefactor;
    }
    
    // 게터 메소드들 - 유틸리티
    public getFileCountManager(): FileCountManager {
        return this.fileCountManager;
    }
    
    public getIntegrityCheck(): IntegrityCheck {
        return this.integrityCheck;
    }
    
    // 유틸리티 메소드들
    public createTTSInstance(): OpenAITTS {
        return new OpenAITTS(this.plugin);
    }
}