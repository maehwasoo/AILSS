import { App, TFile } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { AINoteMerge } from './noteRefactor/aiNoteMerge';
import { AINoteSplit } from './noteRefactor/aiNoteSplit';
import { AINoteAdjust } from './noteRefactor/aiNoteAdjust';
import { NoteResult, SplitResult } from './noteRefactor/types';

/**
 * AINoteRefactor 클래스는 노트 리팩토링의 다양한 기능을 제공하는 파사드 역할을 합니다.
 * 내부적으로는 각 기능별로 분리된 클래스들을 사용합니다.
 */
export class AINoteRefactor {
    private app: App;
    private plugin: AILSSPlugin;
    
    // 각 기능별 처리기
    private noteMerge: AINoteMerge;
    private noteSplit: AINoteSplit;
    private noteAdjust: AINoteAdjust;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
        
        // 각 기능별 처리기 초기화
        const dependencies = { app, plugin };
        this.noteMerge = new AINoteMerge(dependencies);
        this.noteSplit = new AINoteSplit(dependencies);
        this.noteAdjust = new AINoteAdjust(dependencies);
    }

    /**
     * 여러 노트들의 내용을 하나의 노트로 통합합니다.
     * @param targetFile 통합의 대상이 되는 메인 노트
     * @param sourcesFiles 내용을 제공할 소스 노트들
     * @param applyChanges 변경사항을 즉시 적용할지 여부 (기본값: false)
     * @returns 변경될 노트 내용과 메타데이터
     */
    async mergeNotes(
        targetFile: TFile, 
        sourcesFiles: TFile[], 
        applyChanges: boolean = false
    ): Promise<NoteResult> {
        return this.noteMerge.mergeNotes(targetFile, sourcesFiles, applyChanges);
    }

    /**
     * 노트의 내용을 분석하여 여러 개의 노트로 분할합니다.
     * @param sourceFile 분할할 소스 노트
     * @param applyChanges 변경사항을 즉시 적용할지 여부 (기본값: false)
     * @returns 변경될 노트 내용과 생성될 새 노트들의 정보
     */
    async splitNote(
        sourceFile: TFile, 
        applyChanges: boolean = false
    ): Promise<SplitResult> {
        return this.noteSplit.splitNote(sourceFile, applyChanges);
    }

    /**
     * 여러 노트 간의 내용을 주제에 따라 재조정합니다.
     * @param mainFile 메인 노트
     * @param otherFiles 다른 노트들
     * @param applyChanges 변경사항을 즉시 적용할지 여부 (기본값: false)
     * @returns 변경될 노트들의 정보
     */
    async adjustNotes(
        mainFile: TFile, 
        otherFiles: TFile[], 
        applyChanges: boolean = false
    ): Promise<Array<NoteResult>> {
        return this.noteAdjust.adjustNotes(mainFile, otherFiles, applyChanges);
    }
}
