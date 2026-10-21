import type { ReactNode } from 'react';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  /**
   * The role sets the look, the same on every screen: `primary` (default),
   * the screen's main action, one at most (filled); `secondary`, any other
   * action (outlined); `danger`, delete or disconnect (red text). Alone in a
   * section a button takes the full width; in a `ListItem`, it sits at the
   * end of the row.
   */
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

export interface ListItemProps {
  title: string;
  detail?: string;
  /** Actions (buttons), at the end of the row. */
  children?: ReactNode;
}

interface FieldProps {
  label: string;
  help?: string;
}

export interface ToggleProps extends FieldProps {
  value: boolean;
  onChange(value: boolean): void;
}

export interface NumberProps extends FieldProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange(value: number): void;
}

export interface ChoiceProps extends FieldProps {
  value: string;
  options: { value: string; label: string }[];
  onChange(value: string): void;
}

export interface TextFieldProps extends FieldProps {
  value: string;
  onChange(value: string): void;
}

export interface ScreenProps {
  /** The screen's title (native header bar, or heading on the web). */
  title: string;
  /** Hide which device is connected, in the header (the connect screen). */
  noDeviceStatus?: boolean;
  /** `Section`s, or fragments of them. */
  children?: ReactNode;
}

export interface LinkItemProps {
  title: string;
  detail?: string;
  onPress(): void;
}
