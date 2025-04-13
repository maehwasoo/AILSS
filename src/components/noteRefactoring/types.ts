import { App, TFile } from 'obsidian';
import AILSSPlugin from '../../../main';

/**
 * 노트 리팩토링 모달 옵션
 */
export interface NoteRefactoringModalOptions {
    file: TFile;
    id: string;
    title: string;
}

/**
 * 리팩토링 단계 타입
 */
export type RefactoringStep = 'selection' | 'search' | 'preview' | 'aiResult';

/**
 * 리팩토링 옵션 타입
 */
export type RefactoringOption = 'merge' | 'split' | 'adjust';

/**
 * 리팩토링 컴포넌트의 기본 프로퍼티
 */
export interface RefactoringComponentProps {
    app: App;
    plugin: AILSSPlugin;
    options: NoteRefactoringModalOptions;
    selectedNotes: TFile[];
    selectedOption: RefactoringOption | null;
    stepContainer: HTMLElement;
}
