import { Editor } from 'obsidian';
import AILSSPlugin from '../../main';
import { ServiceRegistry } from './serviceRegistry';
import { NoteRefactoringModal } from '../components/noteRefactoringUI/noteRefactoringModal';

/**
 * 플러그인의 모든 명령어를 관리하는 레지스트리
 */
export class CommandRegistry {
    constructor(private plugin: AILSSPlugin, private services: ServiceRegistry) {}
    
    /**
     * 모든 명령어 등록
     */
    public registerAllCommands() {
        this.registerNoteCreationCommands();
        this.registerNoteUpdateCommands();
        this.registerNoteDeletionCommands();
        this.registerNoteMoveCommands();
        this.registerAIImageCommands();
        this.registerAITextCommands();
        this.registerMaintenanceCommands();
        this.registerUtilityCommands();
    }
    
    /**
     * 노트 생성 관련 명령어 등록
     */
    private registerNoteCreationCommands() {
        // 노트 생성
        this.plugin.addCommand({
            id: 'create-neuron',
            name: '노트 생성',
            icon: 'plus',
            callback: () => this.services.getNewNoteManager().createNewNote()
        });
        
        // 노트 연결
        this.plugin.addCommand({
            id: 'connect-neuron',
            name: '노트 연결',
            icon: 'square-plus',
            editorCallback: () => this.services.getLinkNoteManager().createLinkNote()
        });
        
        // 노트 임베드
        this.plugin.addCommand({
            id: 'embed-note',
            name: '노트 임베드',
            icon: 'diamond-plus',
            editorCallback: () => this.services.getEmbedNoteManager().createEmbedNote()
        });
        
        // 노트 복사
        this.plugin.addCommand({
            id: 'copy-note',
            name: '노트 복사',
            icon: 'copy-plus',
            editorCallback: () => this.services.getCopyNoteManager().createCopyNote()
        });
        
        // 노트 복제
        this.plugin.addCommand({
            id: 'duplicate-note',
            name: '노트 복제',
            icon: 'copy',
            callback: () => this.services.getDuplicateNoteManager().duplicateCurrentNote()
        });
        
        // 노트 복구
        this.plugin.addCommand({
            id: 'recover-note',
            name: '노트 복구',
            icon: 'rotate-ccw',
            editorCallback: () => this.services.getRecoverNoteManager().recoverNote()
        });
    }
    
    /**
     * 노트 업데이트 관련 명령어 등록
     */
    private registerNoteUpdateCommands() {
        // 태그 동기화
        this.plugin.addCommand({
            id: 'sync-neuron-tags',
            name: '태그 동기화',
            icon: 'tags',
            callback: () => this.services.getUpdateTagsManager().openTagSyncModal()
        });
        
        // 노트 강화
        this.plugin.addCommand({
            id: 'strengthen-neuron',
            name: '노트 강화',
            icon: 'zap',
            callback: () => this.services.getPotentiateManager().potentiateNote()
        });
        
        // 첨부파일 동기화
        this.plugin.addCommand({
            id: 'sync-attachments',
            name: '첨부파일 동기화',
            icon: 'folder-sync',
            callback: () => this.services.getUpdateAttachmentsManager().updateAttachments()
        });
        
        // 노트 링크 해제
        this.plugin.addCommand({
            id: 'unlink-notes',
            name: '노트 링크 해제',
            icon: 'unlink',
            editorCallback: () => this.services.getUnlinkNotesManager().unlinkSelectedNotes()
        });
    }
    
    /**
     * 노트 삭제 관련 명령어 등록
     */
    private registerNoteDeletionCommands() {
        // 노트 삭제
        this.plugin.addCommand({
            id: 'delete-neuron',
            name: '노트 삭제',
            icon: 'x',
            callback: () => this.services.getDeleteCurrentNoteManager().deleteNote()
        });
        
        // 첨부파일 삭제
        this.plugin.addCommand({
            id: 'delete-attachment',
            name: '첨부파일 삭제',
            icon: 'delete',
            editorCallback: () => this.services.getDeleteAttachmentManager().deleteLink()
        });
    }
    
    /**
     * 노트 이동 관련 명령어 등록
     */
    private registerNoteMoveCommands() {
        // 노트 비활성화
        this.plugin.addCommand({
            id: 'deactivate-neuron',
            name: '노트 비활성화',
            icon: 'heart-off',
            callback: () => this.services.getDeactivateNotesManager().deactivateNotesByTag()
        });
        
        // 노트 활성화
        this.plugin.addCommand({
            id: 'activate-neuron',
            name: '노트 활성화',
            icon: 'heart-pulse',
            callback: () => this.services.getActivateNotesManager().activateNotes()
        });
        
        // 노트 내보내기
        this.plugin.addCommand({
            id: 'export-notes',
            name: '노트 내보내기',
            icon: 'file-output',
            callback: () => this.services.getExportNotesManager().exportNotesByTag()
        });
        
        // 노트 갱신
        this.plugin.addCommand({
            id: 'refresh-neuron',
            name: '노트 갱신',
            icon: 'activity',
            callback: () => this.services.getRenewNoteManager().renewCurrentNote()
        });
    }
    
    /**
     * AI 이미지 관련 명령어 등록
     */
    private registerAIImageCommands() {
        // 이미지 분석
        this.plugin.addCommand({
            id: 'run-image-analyzer',
            name: '이미지 분석',
            icon: 'scan-search',
            editorCallback: () => this.services.getAIImageAnalyzer().main()
        });
        
        // AI 이미지 생성
        this.plugin.addCommand({
            id: 'generate-ai-image',
            name: 'AI 이미지 생성',
            icon: 'image-plus',
            editorCallback: () => this.services.getAIImageCreator().main()
        });
    }
    
    /**
     * AI 텍스트 관련 명령어 등록
     */
    private registerAITextCommands() {
        // AI 답변
        this.plugin.addCommand({
            id: 'generate-ai-answer',
            name: 'AI 답변',
            icon: 'messages-square',
            editorCallback: () => this.services.getAIAnswer().main()
        });
        
        // AI 노트 연결
        this.plugin.addCommand({
            id: 'connect-ai-neuron',
            name: 'AI 노트 연결',
            icon: 'dna',
            editorCallback: () => this.services.getAILinkNote().createAILinkNote()
        });
        
        // LaTeX 수식 변환
        this.plugin.addCommand({
            id: 'convert-latex',
            name: 'LaTeX 수식 변환',
            icon: 'sigma',
            editorCallback: () => this.services.getAILatexMath().main()
        });
        
        // 노트 시각화
        this.plugin.addCommand({
            id: 'visualize-neuron',
            name: '노트 시각화',
            icon: 'view',
            editorCallback: () => this.services.getAIVisualizer().main()
        });
        
        // AI 명령 처리
        this.plugin.addCommand({
            id: 'process-ai-command',
            name: 'AI 명령 처리',
            icon: 'terminal',
            editorCallback: () => this.services.getAIProcess().main()
        });
        
        // 텍스트 재구성
        this.plugin.addCommand({
            id: 'reformat-text',
            name: '텍스트 재구성',
            icon: 'list',
            editorCallback: () => this.services.getAIReformat().main()
        });
        
        // 노트 리팩토링
        this.plugin.addCommand({
            id: 'note-refactoring',
            name: '노트 리팩토링',
            icon: 'git-graph',
            callback: () => NoteRefactoringModal.openForActiveNote(this.plugin.app, this.plugin)
        });
        
        // 노트 재구조화
        this.plugin.addCommand({
            id: 'restructure-note',
            name: '노트 채우기',
            icon: 'boxes',
            editorCallback: () => this.services.getAINoteRestructure().main()
        });
        
        // 태그/별칭 분석
        this.plugin.addCommand({
            id: 'analyze-tags-aliases',
            name: '태그/별칭 분석',
            icon: 'tag',
            editorCallback: () => this.services.getAITagAliasRefactor().main()
        });
        
        // TTS 변환
        this.plugin.addCommand({
            id: 'convert-text-to-speech',
            name: 'TTS 변환',
            icon: 'mic',
            editorCallback: (editor: Editor) => {
                const tts = this.services.createTTSInstance();
                tts.convertTextToSpeech(editor);
            }
        });
        
        // 자연스러운 TTS 변환
        this.plugin.addCommand({
            id: 'convert-text-to-natural-speech',
            name: '자연스러운 TTS 변환',
            icon: 'message-square-text',
            editorCallback: (editor: Editor) => {
                const naturalTTS = this.services.createNaturalTTSInstance();
                naturalTTS.convertTextToNaturalSpeech(editor);
            }
        });
    }
    
    /**
     * 유지 관리 관련 명령어 등록
     */
    private registerMaintenanceCommands() {
        // 무결성 검사
        this.plugin.addCommand({
            id: 'check-neural-network',
            name: '무결성 검사',
            icon: 'shield-check',
            callback: () => this.services.getIntegrityCheck().checkIntegrity()
        });
        
        // 전역 그래프 초기화
        this.plugin.addCommand({
            id: 'configure-global-network',
            name: '전역 그래프 초기화',
            icon: 'waypoints',
            callback: () => this.services.getGlobalGraphManager().applyGlobalGraphConfig()
        });
    }
    
    /**
     * 기타 유틸리티 명령어 등록
     */
    private registerUtilityCommands() {
        // 추가 유틸리티 명령어가 있을 경우 여기에 등록
    }
}