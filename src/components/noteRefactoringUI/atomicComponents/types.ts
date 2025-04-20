import { App, TFile } from 'obsidian';
import AILSSPlugin from '../../../../main';

export type RefactoringOption = 'merge' | 'split' | 'adjust';

/**
 * 리팩토링 컴포넌트에 공통으로 전달되는 속성들
 */
export interface RefactoringComponentProps {
    app: App;
    plugin: AILSSPlugin;
    currentFile: TFile;
    stepContainer: HTMLElement;
    selectedOption: RefactoringOption | null;
    fileId: string;
    fileTitle: string;
}