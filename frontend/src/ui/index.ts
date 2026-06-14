// Primitives
export { Button } from "./button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./button";

export { FactGrid } from "./fact-grid";
export type { FactGridColumns, FactGridItem, FactGridVariant } from "./fact-grid";
export { MarkdownContent } from "./markdown-content";
export { RightDetailPanel } from "./right-detail-panel";
export type { RightDetailPanelProps } from "./right-detail-panel";

// Form Controls
export { Input } from "./input";
export type { InputProps } from "./input";

export { Select } from "./select";
export type { SelectProps, SelectOption } from "./select";

export { Textarea } from "./textarea";
export type { TextareaProps } from "./textarea";

export { Checkbox } from "./checkbox";
export type { CheckboxProps } from "./checkbox";

export { FormField } from "./form-field";
export type { FormFieldProps } from "./form-field";

export { FormSection, CheckboxRow } from "./form-layout";

export { SearchInput } from "./search-input";
export type { SearchInputProps } from "./search-input";

// Compound Components
export { UiModal, UiModalHeader } from "./modal";
export type { UiModalProps, UiModalHeaderProps } from "./modal";

export { Tabs } from "./tabs";
export type { TabsProps, TabItem, TabVariant } from "./tabs";

export { Card } from "./card";
export type { CardProps, CardPadding } from "./card";

export { Alert } from "./alert";
export type { AlertProps, AlertVariant } from "./alert";

// Migrated from components/shared/
export { PageState } from "./page-state";
export type { PageStateProps } from "./page-state";

export { RefreshButton } from "./refresh-button";
export type { RefreshButtonProps } from "./refresh-button";

// Table
export { Table, THead, TBody, TRow, TH, TCell } from "./table";
export type { TableProps, THeadProps, TBodyProps, TRowProps, THProps, TCellProps } from "./table";

// Shared app/page composition
export { AppPage, PageHeader, SectionNav, RefreshIconButton } from "./page";
export type { SectionNavItem } from "./page";

export {
  ListGroup,
  ListRow,
  RowDetailLine,
  RowFacts,
  RowValue,
  EmptySafeNotice,
  KeyValueRow,
} from "./list";
export type { RowFact } from "./list";

export { Slider } from "./slider";
export { SegmentedControl } from "./segmented-control";
export type { SegmentedItem } from "./segmented-control";
export { ColorField } from "./color-field";

// Display primitives
export { ProgressBar } from "./progress-bar";
export { Stat } from "./stat";
export { SectionLabel } from "./section-label";
export { ErrorBox } from "./error-box";

export { StatusDot, StatusPill } from "./status";
export type { UiTone, StatusPillVariant } from "./status";

export { ModelLogo } from "./model-logo";
export { HuggingFaceModelCardPanel } from "./huggingface-model-card";

export { ModelStopConfirm } from "./model-stop-confirm";

// Page-specialized adapters kept in /ui so library swaps happen in one place.
export {
  SettingsLayout,
  SettingsFactRows,
  SettingsGroup,
  SettingsRow,
  SettingsValue,
  SettingsButton,
  SettingsInput,
  SettingsTextarea,
  SettingsNotice,
  SettingsActions,
} from "./settings";
export type {
  SettingsFactRow,
  SettingsSectionDef,
  SettingsSectionId,
  StatusTone,
} from "./settings";

export {
  ModelSection,
  ModelRow,
  ModelValue,
  ModelStatus,
  ModelButton,
  ModelInput,
} from "./model-page";
export type { ModelStatusTone } from "./model-page";
