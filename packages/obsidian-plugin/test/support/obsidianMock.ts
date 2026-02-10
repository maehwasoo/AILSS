export interface ToggleControl {
	kind: "toggle";
	onChange?: (value: boolean) => unknown;
}

export interface TextControl {
	kind: "text";
	onChange?: (value: string) => unknown;
}

export interface TextAreaControl {
	kind: "textarea";
	onChange?: (value: string) => unknown;
}

export interface DropdownControl {
	kind: "dropdown";
	onChange?: (value: string) => unknown;
}

export interface ButtonControl {
	kind: "button";
	onClick?: () => unknown;
}

export type ControlRecord =
	| ToggleControl
	| TextControl
	| TextAreaControl
	| DropdownControl
	| ButtonControl;

export interface SettingRecord {
	name: string;
	desc: unknown;
	controls: ControlRecord[];
}

interface MockElement {
	empty: () => void;
	createEl: (tag: string, options?: { text?: string }) => MockElement;
	createDiv: () => MockElement;
}

const settingRecords: SettingRecord[] = [];
const noticeMessages: string[] = [];

function createElement(_tag: string): MockElement {
	return {
		empty: () => {},
		createEl: (tag: string) => createElement(tag),
		createDiv: () => createElement("div"),
	};
}

export class App {}

export class Notice {
	constructor(message: string) {
		noticeMessages.push(message);
	}
}

export class PluginSettingTab {
	containerEl: MockElement;

	constructor(_app: unknown, _plugin: unknown) {
		this.containerEl = createElement("div");
	}
}

export class Setting {
	private readonly record: SettingRecord;

	constructor(_containerEl: unknown) {
		this.record = { name: "", desc: "", controls: [] };
		settingRecords.push(this.record);
	}

	setName(name: string): this {
		this.record.name = name;
		return this;
	}

	setDesc(desc: unknown): this {
		this.record.desc = desc;
		return this;
	}

	addToggle(
		cb: (toggle: {
			setValue: (value: boolean) => unknown;
			onChange: (fn: (value: boolean) => unknown) => unknown;
		}) => void,
	): this {
		const control: ToggleControl = { kind: "toggle" };
		const toggle = {
			setValue: (_value: boolean) => toggle,
			onChange: (fn: (value: boolean) => unknown) => {
				control.onChange = fn;
				return toggle;
			},
		};
		cb(toggle);
		this.record.controls.push(control);
		return this;
	}

	addText(
		cb: (text: {
			inputEl: { type: string };
			setPlaceholder: (value: string) => unknown;
			setValue: (value: string) => unknown;
			onChange: (fn: (value: string) => unknown) => unknown;
		}) => void,
	): this {
		const control: TextControl = { kind: "text" };
		const text = {
			inputEl: { type: "text" },
			setPlaceholder: (_value: string) => text,
			setValue: (_value: string) => text,
			onChange: (fn: (value: string) => unknown) => {
				control.onChange = fn;
				return text;
			},
		};
		cb(text);
		this.record.controls.push(control);
		return this;
	}

	addTextArea(
		cb: (text: {
			setValue: (value: string) => unknown;
			onChange: (fn: (value: string) => unknown) => unknown;
		}) => void,
	): this {
		const control: TextAreaControl = { kind: "textarea" };
		const text = {
			setValue: (_value: string) => text,
			onChange: (fn: (value: string) => unknown) => {
				control.onChange = fn;
				return text;
			},
		};
		cb(text);
		this.record.controls.push(control);
		return this;
	}

	addDropdown(
		cb: (dropdown: {
			addOption: (value: string, label: string) => unknown;
			setValue: (value: string) => unknown;
			onChange: (fn: (value: string) => unknown) => unknown;
		}) => void,
	): this {
		const control: DropdownControl = { kind: "dropdown" };
		const dropdown = {
			addOption: (_value: string, _label: string) => dropdown,
			setValue: (_value: string) => dropdown,
			onChange: (fn: (value: string) => unknown) => {
				control.onChange = fn;
				return dropdown;
			},
		};
		cb(dropdown);
		this.record.controls.push(control);
		return this;
	}

	addButton(
		cb: (button: {
			setButtonText: (value: string) => unknown;
			setCta: () => unknown;
			setWarning: () => unknown;
			onClick: (fn: () => unknown) => unknown;
		}) => void,
	): this {
		const control: ButtonControl = { kind: "button" };
		const button = {
			setButtonText: (_value: string) => button,
			setCta: () => button,
			setWarning: () => button,
			onClick: (fn: () => unknown) => {
				control.onClick = fn;
				return button;
			},
		};
		cb(button);
		this.record.controls.push(control);
		return this;
	}
}

export function resetObsidianMockState(): void {
	settingRecords.length = 0;
	noticeMessages.length = 0;
}

export function getSettingRecords(): SettingRecord[] {
	return settingRecords;
}

export function getNoticeMessages(): string[] {
	return noticeMessages;
}
