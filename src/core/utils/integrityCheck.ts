import { App, TFile, TFolder, Notice, Modal } from 'obsidian';
import { moment } from 'obsidian';
import type AILSSPlugin from 'main';
import { PathSettings } from '../settings/pathSettings';
import { FrontmatterManager, DefaultFrontmatterConfig } from './frontmatterManager';
import { showConfirmationDialog } from '../../components/commonUI/confirmationModal';

interface IntegrityCheckOptions {
    path: string;
    recursive: boolean;
}

interface IntegrityReport {
    timestamp: string;
    checkedPath: string;
    statistics: {
        folderCount: number;
        fileCount: number;
        noteCount: number;
        attachmentCount: number;
    };
    emptyFolders: string[];
    orphanedAttachments: string[];
    brokenLinks: string[];
    invalidFrontmatters: {
        path: string;
        errors: string[];
    }[];
    invalidFileNames: string[];
}

export class IntegrityCheck {
    private app: App;
    private plugin: AILSSPlugin;
    private frontmatterManager: FrontmatterManager;

    constructor(app: App, plugin: AILSSPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.frontmatterManager = new FrontmatterManager();
    }

    async showPathSelectionDialog(): Promise<string | null> {
        return new Promise((resolve) => {
            const modal = new PathSelectionModal(this.app, {
                title: "경로 입력",
                placeholder: "예: 2024/01/22 (미입력시 전체 검사)",
                confirmText: "검사",
                cancelText: "취소"
            }, (result) => {
                resolve(result);
            });
            modal.open();
        });
    }

    async checkIntegrity(): Promise<void> {
        try {
            const result = await this.showPathSelectionDialog();
            // 취소된 경우 종료
            if (result === null) {
                new Notice("무결성 검사가 취소되었습니다.");
                return;
            }

            const options: IntegrityCheckOptions = {
                path: result.trim(),
                recursive: true
            };

            const confirmed = await showConfirmationDialog(this.app, {
                title: "무결성 검사 확인",
                message: `${options.path ? options.path : "전체 vault"}에 대해 무결성 검사를 실행하시겠습니까?`,
                confirmText: "검사",
                cancelText: "취소"
            });

            if (!confirmed) {
                new Notice("무결성 검사가 취소되었습니다.");
                return;
            }

            const report = await this.performIntegrityCheck(options);
            await this.generateReport(report);
            
            new Notice("무결성 검사가 완료되었습니다. 로그 파일을 확인해주세요.");
        } catch (error) {
            console.error("무결성 검사 중 오류 발생:", error);
            new Notice("무결성 검사 중 오류가 발생했습니다.");
        }
    }

    private async performIntegrityCheck(options: IntegrityCheckOptions): Promise<IntegrityReport> {
        const report: IntegrityReport = {
            timestamp: moment().format('YYYY-MM-DD HH:mm:ss'),
            checkedPath: options.path || '전체 vault',
            statistics: {
                folderCount: 0,
                fileCount: 0,
                noteCount: 0,
                attachmentCount: 0
            },
            emptyFolders: [],
            orphanedAttachments: [],
            brokenLinks: [],
            invalidFrontmatters: [],
            invalidFileNames: []
        };

        const rootFolder = options.path
            ? this.app.vault.getAbstractFileByPath(options.path)
            : this.app.vault.getRoot();

        if (!rootFolder) {
            throw new Error("지정된 경로를 찾을 수 없습니다.");
        }

        await this.checkFolder(rootFolder as TFolder, report, options);
        return report;
    }

    private async checkFolder(folder: TFolder, report: IntegrityReport, options: IntegrityCheckOptions): Promise<boolean> {
        // 비활성화 폴더는 검사에서 제외
        if (folder.path === PathSettings.DEACTIVATED_ROOT || folder.path.startsWith(`${PathSettings.DEACTIVATED_ROOT}/`)) {
            return true; // 비활성화 폴더는 유효한 콘텐츠가 있는 것으로 간주
        }

        let hasValidContent = false;
        report.statistics.folderCount++;

        for (const child of folder.children) {
            if (child instanceof TFolder) {
                if (options.recursive) {
                    const hasContent = await this.checkFolder(child, report, options);
                    if (hasContent) hasValidContent = true;
                }
            } else if (child instanceof TFile) {
                report.statistics.fileCount++;
                if (child.extension === 'md') {
                    report.statistics.noteCount++;
                } else if (this.isAttachmentFile(child)) {
                    report.statistics.attachmentCount++;
                }
                hasValidContent = true;
                await this.checkFile(child, report);
            }
        }

        // deactivated 루트 폴더나 루트 폴더('/')는 빈 폴더 검사에서 제외
        if (!hasValidContent && folder.path !== '/' && folder.path !== PathSettings.DEACTIVATED_ROOT) {
            report.emptyFolders.push(folder.path);
        }

        return hasValidContent;
    }

    private async checkFile(file: TFile, report: IntegrityReport): Promise<void> {
        // 경로 형식 검사 추가
        if (!PathSettings.PATH_REGEX.test(file.parent?.path || '')) {
            report.invalidFileNames.push(`${file.path} (잘못된 경로 형식)`);
        }

        // 마크다운 파일 검사
        if (file.extension === 'md') {
            // integrity-check 리포트 파일은 프론트매터 검사에서 제외
            if (file.basename.startsWith('integrity-check-')) {
                return;
            }
            
            const content = await this.app.vault.read(file);
            
            // 프론트매터 검사
            const frontmatter = this.frontmatterManager.parseFrontmatter(content);
            if (!frontmatter) {
                report.invalidFrontmatters.push({
                    path: file.path,
                    errors: ["프론트매터가 없거나 형식이 잘못됨"]
                });
                return;
            }
            const frontmatterErrors = this.validateFrontmatter(frontmatter, file);
            if (frontmatterErrors.length > 0) {
                report.invalidFrontmatters.push({
                    path: file.path,
                    errors: frontmatterErrors
                });
            }

            // 첨부파일 및 노트 링크 검사
            await this.checkLinks(file, content, report);
        } 
        // 첨부파일 검사
        else if (this.isAttachmentFile(file)) {
            // 먼저 연결된 노트 파일이 있는지 확인
            const isOrphaned = await this.isOrphanedAttachment(file);
            if (isOrphaned) {
                report.orphanedAttachments.push(file.path);
            }
            // 연결된 노트가 있더라도 파일명 형식이 완전히 다른 경우만 보고
            else if (!file.basename.startsWith(this.getBaseNoteName(file))) {
                report.invalidFileNames.push(file.path);
            }
        }
    }

    private getBaseNoteName(file: TFile): string {
        const attachmentNameParts = file.basename.split('-');
        return attachmentNameParts[0];
    }

    private async isOrphanedAttachment(file: TFile): Promise<boolean> {
        const noteName = this.getBaseNoteName(file);
        const parentPath = file.parent?.path || '';
        const possibleNotePath = `${parentPath}/${noteName}.md`;

        const noteFile = this.app.vault.getAbstractFileByPath(possibleNotePath);
        return !(noteFile instanceof TFile);
    }

    private validateFrontmatter(frontmatter: Record<string, any>, file: TFile): string[] {
        const errors: string[] = [];
        
        if (!frontmatter) {
            return ["프론트매터가 없거나 형식이 잘못됨"];
        }

        const requiredFields: (keyof DefaultFrontmatterConfig)[] = [
            'title', 'id', 'date', 'aliases', 'tags', 'depth', 'potentiation', 'updated'
        ];
        
        // 필수 필드 존재 여부 확인
        requiredFields.forEach(field => {
            if (!frontmatter.hasOwnProperty(field)) {
                errors.push(`필수 필드 '${field}' 누락`);
            }
        });

        // id 검증
        if (frontmatter.id) {
            if (frontmatter.id !== file.basename) {
                errors.push(`id가 파일명과 불일치 (id: ${frontmatter.id}, 파일명: ${file.basename})`);
            }
            if (!/^\d{14}$/.test(frontmatter.id)) {
                errors.push('id가 14자리 숫자 형식(YYYYMMDDHHmmss)이 아님');
            }
        }

        // 날짜 형식 검증
        if (frontmatter.date && !moment(frontmatter.date, moment.ISO_8601, true).isValid()) {
            errors.push('date가 올바른 ISO 8601 형식이 아님');
        }
        if (frontmatter.updated && !moment(frontmatter.updated, moment.ISO_8601, true).isValid()) {
            errors.push('updated가 올바른 ISO 8601 형식이 아님');
        }

        // aliases 검증
        if (frontmatter.aliases && !Array.isArray(frontmatter.aliases)) {
            errors.push('aliases가 배열 형식이 아님');
        }

        // tags 검증
        if (frontmatter.tags) {
            if (!Array.isArray(frontmatter.tags)) {
                errors.push('tags가 배열 형식이 아님');
            }
        }

        // potentiation 검증
        if (frontmatter.potentiation) {
            const potentiation = Number(frontmatter.potentiation);
            if (isNaN(potentiation)) {
                errors.push('potentiation이 숫자가 아님');
            } else if (potentiation < FrontmatterManager.INITIAL_POTENTIATION || 
                       potentiation > FrontmatterManager.MAX_POTENTIATION) {
                errors.push(`potentiation이 유효 범위를 벗어남 (${FrontmatterManager.INITIAL_POTENTIATION}~${FrontmatterManager.MAX_POTENTIATION})`);
            }
        }

        // depth 검증
        if (frontmatter.depth !== undefined) {
            const depth = Number(frontmatter.depth);
            if (isNaN(depth)) {
                errors.push('depth가 숫자가 아님');
            }
        }

        // date와 id의 시간 일치 여부 검사
        if (frontmatter.date && frontmatter.id) {
            const dateFromISO = moment(frontmatter.date);
            const dateFromId = moment(frontmatter.id, 'YYYYMMDDHHmmss');

            if (dateFromISO.isValid() && dateFromId.isValid()) {
                if (!dateFromISO.isSame(dateFromId)) {
                    errors.push(`date(${frontmatter.date})와 id(${frontmatter.id})의 시간이 일치하지 않음`);
                }
            }
        }

        return errors;
    }

    private async checkLinks(file: TFile, content: string, report: IntegrityReport): Promise<void> {
        const linkRegex = /!\[\[(.*?)\]\]/g;
        let match;

        while ((match = linkRegex.exec(content)) !== null) {
            const linkText = match[1].trim();
            const parts = linkText.split('|');
            const linkPath = parts[0].trim();
            let linkedFile = null;
            
            // 1. 같은 폴더에서 먼저 탐색
            // 파일명에 확장자가 있는 경우
            if (linkPath.includes('.')) {
                const linkedPath = `${file.parent?.path}/${linkPath}`;
                linkedFile = this.app.vault.getAbstractFileByPath(linkedPath);
            } 
            // 확장자가 없는 경우 .md 확장자를 추가해 탐색
            else {
                const mdPath = `${file.parent?.path}/${linkPath}.md`;
                linkedFile = this.app.vault.getAbstractFileByPath(mdPath);
            }
            
            // 2. 14자리 숫자 ID 또는 ID-index 형식이면 YYYY/MM/DD/ 형식 폴더에서 탐색
            if (!linkedFile) {
                // a. 14자리 숫자 ID 패턴 확인 (YYYYMMDDHHMMSS)
                if (/^\d{14}$/.test(linkPath)) {
                    const year = linkPath.substring(0, 4);
                    const month = linkPath.substring(4, 6);
                    const day = linkPath.substring(6, 8);
                    
                    // YYYY/MM/DD/ 형식 폴더에서 찾기
                    const possiblePath = `${year}/${month}/${day}/${linkPath}.md`;
                    linkedFile = this.app.vault.getAbstractFileByPath(possiblePath);
                }
                // b. ID-index 형식 확인 (YYYYMMDDHHMMSS-숫자)
                else if (/^\d{14}-\d+$/.test(linkPath)) {
                    const baseId = linkPath.split('-')[0]; // YYYYMMDDHHMMSS 부분 추출
                    const year = baseId.substring(0, 4);
                    const month = baseId.substring(4, 6);
                    const day = baseId.substring(6, 8);
                    
                    // 첨부파일인 경우 확장자가 붙어있을 수 있음
                    let filePathToCheck = linkPath;
                    if (!linkPath.includes('.')) {
                        filePathToCheck = `${linkPath}.md`;
                    }
                    
                    // YYYY/MM/DD/ 형식 폴더에서 찾기
                    const possiblePath = `${year}/${month}/${day}/${filePathToCheck}`;
                    linkedFile = this.app.vault.getAbstractFileByPath(possiblePath);
                }
            }
            
            // 3. 전체 vault에서 탐색
            if (!linkedFile) {
                if (linkPath.includes('.')) {
                    // 확장자가 있는 경우
                    const allFiles = this.app.vault.getAllLoadedFiles();
                    const foundFile = allFiles.find(f => f.name === linkPath);
                    if (foundFile instanceof TFile) {
                        linkedFile = foundFile;
                    }
                } else {
                    // 확장자가 없는 경우 마크다운 파일로 가정하고 검색
                    const allMarkdownFiles = this.app.vault.getMarkdownFiles();
                    const foundMdFile = allMarkdownFiles.find(mdFile => mdFile.basename === linkPath);
                    if (foundMdFile) {
                        linkedFile = foundMdFile;
                    }
                }
            }
            
            // 링크 유효성 판단
            if (!linkedFile) {
                report.brokenLinks.push(`${file.path} -> ${linkPath} (깨진 링크)`);
            } else if (linkedFile instanceof TFile) {
                // 마크다운 파일인 경우 노트 이름 형식 검사
                if (linkedFile.extension === 'md') {
                    if (!this.isValidNoteName(linkedFile)) {
                        report.invalidFileNames.push(`${linkedFile.path} (잘못된 노트 ID 형식)`);
                    }
                } 
                // 첨부파일인 경우 이름 규칙 검사
                else if (this.isAttachmentFile(linkedFile)) {
                    if (!this.isValidAttachmentName(linkedFile)) {
                        report.invalidFileNames.push(linkedFile.path);
                    }
                }
            }
        }
    }

    private isAttachmentFile(file: TFile): boolean {
        const attachmentExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'mp3', 'wav', 'mp4', 'webm', 'pdf'];
        return attachmentExtensions.includes(file.extension.toLowerCase());
    }

    private isValidAttachmentName(file: TFile): boolean {
        // 첨부파일 이름이 "노트ID-숫자.확장자" 형식인지 확인
        const attachmentNameParts = file.basename.split('-');
        const noteId = this.getBaseNoteName(file);
        
        // 첨부파일 이름이 노트ID로 시작하고, -숫자 형식으로 끝나는지 확인
        const pattern = new RegExp(`^${noteId}-\\d+$`);
        return pattern.test(file.basename);
    }

    private isValidNoteName(file: TFile): boolean {
        // 노트 파일 이름이 14자리 숫자(YYYYMMDDHHmmss) 형식인지 확인
        return /^\d{14}$/.test(file.basename);
    }

    private async generateReport(report: IntegrityReport): Promise<void> {
        let content = `# 무결성 검사 보고서\n\n`;
        content += `## 검사 정보\n`;
        content += `- 검사 시간: ${report.timestamp}\n`;
        content += `- 검사 경로: ${report.checkedPath}\n\n`;

        content += `## 검사 통계\n`;
        content += `- 검사한 폴더 수: **${report.statistics.folderCount}**개\n`;
        content += `- 검사한 전체 파일 수: **${report.statistics.fileCount}**개\n`;
        content += `- 노트 파일 수: **${report.statistics.noteCount}**개\n`;
        content += `- 첨부 파일 수: **${report.statistics.attachmentCount}**개\n\n`;

        content += `## 빈 폴더 (**${report.emptyFolders.length}**개)\n`;
        report.emptyFolders.forEach(path => {
            content += `- ${path}\n`;
        });

        content += `\n## 고아 첨부파일 (**${report.orphanedAttachments.length}**개)\n`;
        report.orphanedAttachments.forEach(path => {
            content += `- ${path}\n`;
        });

        content += `\n## 깨진 링크 (**${report.brokenLinks.length}**개)\n`;
        report.brokenLinks.forEach(path => {
            content += `- ${path}\n`;
        });

        content += `\n## 잘못된 프론트매터 (**${report.invalidFrontmatters.length}**개)\n`;
        report.invalidFrontmatters.forEach(item => {
            content += `- ${item.path}\n`;
            item.errors.forEach(error => {
                content += `  - ${error}\n`;
            });
        });

        content += `\n## 잘못된 첨부파일명 또는 경로 (**${report.invalidFileNames.length}**개)\n`;
        report.invalidFileNames.forEach(path => {
            content += `- ${path}\n`;
        });

        // 총계 섹션 추가
        const totalIssues = report.emptyFolders.length + 
                           report.orphanedAttachments.length + 
                           report.brokenLinks.length +
                           report.invalidFrontmatters.length + 
                           report.invalidFileNames.length;

        content += `\n## 총계\n`;
        content += `- 전체 문제 수: **${totalIssues}**개\n`;
        content += `  - 빈 폴더: **${report.emptyFolders.length}**개\n`;
        content += `  - 고아 첨부파일: **${report.orphanedAttachments.length}**개\n`;
        content += `  - 깨진 링크: **${report.brokenLinks.length}**개\n`;
        content += `  - 잘못된 프론트매터: **${report.invalidFrontmatters.length}**개\n`;
        content += `  - 잘못된 첨부파일명 또는 경로: **${report.invalidFileNames.length}**개\n`;

        const reportFileName = `integrity-check-${moment().format('YYYYMMDD-HHmmss')}.md`;
        await this.app.vault.create(reportFileName, content);
    }
}

class PathSelectionModal extends Modal {
    private resolve: (result: string | null) => void;
    private options: {
        title: string;
        placeholder: string;
        confirmText: string;
        cancelText: string;
    };

    constructor(app: App, options: any, onSubmit: (result: string | null) => void) {
        super(app);
        this.options = options;
        this.resolve = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        const container = contentEl.createDiv({
            cls: "path-selection-modal-container",
            attr: { style: "padding: 2rem;" }
        });

        container.createEl("h3", {
            text: this.options.title,
            attr: { style: "margin: 0 0 1.5rem 0;" }
        });

        const input = container.createEl("input", {
            type: "text",
            attr: {
                placeholder: this.options.placeholder,
                style: "width: 100%; margin-bottom: 2rem;"
            }
        });

        const buttonContainer = container.createDiv({
            attr: { style: "display: flex; justify-content: flex-end; gap: 0.8rem;" }
        });

        const cancelButton = buttonContainer.createEl("button", {
            text: this.options.cancelText
        });
        cancelButton.onclick = () => {
            this.close();
            this.resolve(null);  // 취소시 null 반환
        };

        const confirmButton = buttonContainer.createEl("button", {
            text: this.options.confirmText,
            cls: "mod-cta"
        });
        confirmButton.onclick = () => {
            this.close();
            this.resolve(input.value);  // 빈 문자열 포함 입력값 그대로 반환
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
