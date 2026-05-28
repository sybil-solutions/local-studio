// Primitives
export { Button } from "./button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./button";

export { Badge } from "./badge";
export type { BadgeProps, BadgeVariant, BadgeSize } from "./badge";

export { Spinner } from "./spinner";
export type { SpinnerProps, SpinnerSize } from "./spinner";

export { EmptyState } from "./empty-state";
export type { EmptyStateProps } from "./empty-state";

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
export { Modal, UiModal, UiModalHeader } from "./modal";
export type { ModalProps, ModalMaxWidth, UiModalProps, UiModalHeaderProps } from "./modal";

export { Tabs } from "./tabs";
export type { TabsProps, TabItem, TabVariant } from "./tabs";

export { Card, CardHeader } from "./card";
export type { CardProps, CardHeaderProps, CardPadding } from "./card";

export { Alert } from "./alert";
export type { AlertProps, AlertVariant } from "./alert";

export { ToolDropdown, DropdownItem } from "./dropdown-menu";
export type { ToolDropdownProps, DropdownItemProps } from "./dropdown-menu";

// Migrated from components/shared/
export { PageState } from "./page-state";
export type { PageStateProps } from "./page-state";

export { ChangeIndicator } from "./change-indicator";
export type { ChangeIndicatorProps } from "./change-indicator";

export { RefreshButton } from "./refresh-button";
export type { RefreshButtonProps } from "./refresh-button";

// Table
export { Table, THead, TBody, TRow, TH, TCell } from "./table";
export type { TableProps, THeadProps, TBodyProps, TRowProps, THProps, TCellProps } from "./table";

// Shared app/page composition
export { AppPage, PageHeader, SectionNav, RefreshIconButton } from "./page";
export type { SectionNavItem } from "./page";

export { ListGroup, ListRow, RowValue, EmptySafeNotice, KeyValueRow } from "./list";

export { StatusDot, StatusPill } from "./status";
export type { UiTone, StatusPillVariant } from "./status";

export { LeftSidebar } from "./left-sidebar";
export { ModelStopConfirm } from "./model-stop-confirm";
export {
  ProjectsNavSection,
  consumeAgentSessionNavTitle,
  mergeActiveSessionPref,
  rememberAgentSessionNavTitle,
  triggerAddProjectFlow,
} from "./projects-nav-section";
export { SessionsCommand } from "./sessions-command";

// Page-specialized adapters kept in /ui so library swaps happen in one place.
export {
  SettingsLayout,
  SettingsGroup,
  SettingsRow,
  SettingsValue,
  SettingsButton,
  SettingsInput,
} from "./settings";
export type { SettingsSectionDef, SettingsSectionId, StatusTone } from "./settings";

export {
  ModelSection,
  ModelRow,
  ModelValue,
  ModelStatus,
  ModelButton,
  ModelInput,
} from "./model-page";
export type { ModelStatusTone } from "./model-page";
