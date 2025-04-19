import { MarkdownView } from 'obsidian';
import AILSSPlugin from '../../main';
import { ServiceRegistry } from './serviceRegistry';
import { NoteRefactoringModal } from '../components/noteRefactoringUI/noteRefactoringModal';

/**
 * 플러그인의 모든 리본 메뉴를 관리하는 레지스트리
 */
export class RibbonRegistry {
    constructor(private plugin: AILSSPlugin, private services: ServiceRegistry) {}
    
    /**
     * 모든 리본 아이콘 추가
     */
    public addAllRibbonIcons() {
        this.addNoteCreationRibbons();
        this.addNoteUpdateRibbons();
        this.addNoteDeletionRibbons();
        this.addNoteMoveRibbons();
        this.addAIImageRibbons();
        this.addAITextRibbons();
        this.addMaintenanceRibbons();
    }
    
    /**
     * 노트 생성 관련 리본 아이콘 추가
     */
    private addNoteCreationRibbons() {
        // 노트 생성
        this.plugin.addRibbonIcon('plus', '노트 생성', () => {
            this.services.getNewNoteManager().createNewNote();
        });
        
        // 노트 연결
        this.plugin.addRibbonIcon('square-plus', '노트 연결', () => {
            this.services.getLinkNoteManager().createLinkNote();
        });
        
        // 노트 임베드
        this.plugin.addRibbonIcon('diamond-plus', '노트 임베드', () => {
            this.services.getEmbedNoteManager().createEmbedNote();
        });
        
        // 노트 복사
        this.plugin.addRibbonIcon('copy-plus', '노트 복사', () => {
            this.services.getCopyNoteManager().createCopyNote();
        });
        
        // 노트 복제
        this.plugin.addRibbonIcon('copy', '노트 복제', () => {
            this.services.getDuplicateNoteManager().duplicateCurrentNote();
        });
        
        // 노트 복구
        this.plugin.addRibbonIcon('rotate-ccw', '노트 복구', () => {
            this.services.getRecoverNoteManager().recoverNote();
        });
    }
    
    /**
     * 노트 업데이트 관련 리본 아이콘 추가
     */
    private addNoteUpdateRibbons() {
        // 태그 동기화
        this.plugin.addRibbonIcon('tags', '태그 동기화', () => {
            this.services.getUpdateTagsManager().openTagSyncModal();
        });
        
        // 노트 강화
        this.plugin.addRibbonIcon('zap', '노트 강화', () => {
            this.services.getPotentiateManager().potentiateNote();
        });
        
        // 첨부파일 동기화
        this.plugin.addRibbonIcon('folder-sync', '첨부파일 동기화', () => {
            this.services.getUpdateAttachmentsManager().updateAttachments();
        });
        
        // 노트 링크 해제
        this.plugin.addRibbonIcon('unlink', '노트 링크 해제', () => {
            this.services.getUnlinkNotesManager().unlinkSelectedNotes();
        });
    }
    
    /**
     * 노트 삭제 관련 리본 아이콘 추가
     */
    private addNoteDeletionRibbons() {
        // 노트 삭제
        this.plugin.addRibbonIcon('x', '노트 삭제', () => {
            this.services.getDeleteCurrentNoteManager().deleteNote();
        });
        
        // 첨부파일 삭제
        this.plugin.addRibbonIcon('delete', '첨부파일 삭제', () => {
            this.services.getDeleteAttachmentManager().deleteLink();
        });
    }
    
    /**
     * 노트 이동 관련 리본 아이콘 추가
     */
    private addNoteMoveRibbons() {
        // 노트 비활성화
        this.plugin.addRibbonIcon('heart-off', '노트 비활성화', () => {
            this.services.getDeactivateNotesManager().deactivateNotesByTag();
        });
        
        // 노트 활성화
        this.plugin.addRibbonIcon('heart-pulse', '노트 활성화', () => {
            this.services.getActivateNotesManager().activateNotes();
        });
        
        // 노트 내보내기
        this.plugin.addRibbonIcon('file-output', '노트 내보내기', () => {
            this.services.getExportNotesManager().exportNotesByTag();
        });
        
        // 노트 갱신
        this.plugin.addRibbonIcon('activity', '노트 갱신', () => {
            this.services.getRenewNoteManager().renewCurrentNote();
        });
    }
    
    /**
     * AI 이미지 관련 리본 아이콘 추가
     */
    private addAIImageRibbons() {
        // 이미지 분석
        this.plugin.addRibbonIcon('scan-search', '이미지 분석', () => {
            this.services.getAIImageAnalyzer().main();
        });
        
        // AI 이미지 생성
        this.plugin.addRibbonIcon('image-plus', 'AI 이미지 생성', () => {
            this.services.getAIImageCreator().main();
        });
    }
    
    /**
     * AI 텍스트 관련 리본 아이콘 추가
     */
    private addAITextRibbons() {
        // AI 답변
        this.plugin.addRibbonIcon('messages-square', 'AI 답변', () => {
            this.services.getAIAnswer().main();
        });
        
        // AI 노트 연결
        this.plugin.addRibbonIcon('dna', 'AI 노트 연결', () => {
            this.services.getAILinkNote().createAILinkNote();
        });
        
        // LaTeX 수식 변환
        this.plugin.addRibbonIcon('sigma', 'LaTeX 수식 변환', () => {
            this.services.getAILatexMath().main();
        });
        
        // 노트 시각화
        this.plugin.addRibbonIcon('view', '노트 시각화', () => {
            this.services.getAIVisualizer().main();
        });
        
        // AI 명령 처리
        this.plugin.addRibbonIcon('terminal', 'AI 명령 처리', () => {
            this.services.getAIProcess().main();
        });
        
        // 텍스트 재구성
        this.plugin.addRibbonIcon('list', '텍스트 재구성', () => {
            this.services.getAIReformat().main();
        });
        
        // 노트 리팩토링
        this.plugin.addRibbonIcon('git-graph', '노트 리팩토링', () => {
            NoteRefactoringModal.openForActiveNote(this.plugin.app, this.plugin);
        });
        
        // 노트 재구조화
        this.plugin.addRibbonIcon('boxes', '노트 채우기', () => {
            this.services.getAINoteRestructure().main();
        });
        
        // 태그/별칭 분석
        this.plugin.addRibbonIcon('tag', '태그/별칭 분석', () => {
            this.services.getAITagAliasRefactor().main();
        });
        
        // TTS 변환
        this.plugin.addRibbonIcon('mic', 'TTS 변환', () => {
            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (view && view.editor) {
                const tts = this.services.createTTSInstance();
                tts.convertTextToSpeech(view.editor);
            }
        });
        
        // 자연스러운 TTS 변환
        this.plugin.addRibbonIcon('message-square-text', '자연스러운 TTS 변환', () => {
            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (view && view.editor) {
                const naturalTTS = this.services.createNaturalTTSInstance();
                naturalTTS.convertTextToNaturalSpeech(view.editor);
            }
        });
    }
    
    /**
     * 유지 관리 관련 리본 아이콘 추가
     */
    private addMaintenanceRibbons() {
        // 무결성 검사
        this.plugin.addRibbonIcon('shield-check', '무결성 검사', () => {
            this.services.getIntegrityCheck().checkIntegrity();
        });
        
        // 전역 그래프 초기화
        this.plugin.addRibbonIcon('waypoints', '전역 그래프 초기화', () => {
            this.services.getGlobalGraphManager().applyGlobalGraphConfig();
        });
    }
}