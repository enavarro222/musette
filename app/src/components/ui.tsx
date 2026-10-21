/**
 * Musette's UI kit, iOS and Android: @expo/ui, so real SwiftUI and Jetpack
 * Compose views. The web has its own look with the same API (`ui.web.tsx`).
 * Screens use only these.
 */
import {
  Button as UiButton,
  Column,
  FieldGroup,
  Host,
  Picker,
  RNHostView,
  Row,
  Slider,
  Spacer,
  Switch,
  Text,
  TextInput,
} from '@expo/ui';
import { Stack } from 'expo-router';
import { createContext, useContext, type ReactElement } from 'react';
import { Pressable, Text as RNText, useWindowDimensions, View } from 'react-native';
import { theme } from '../theme';
import { useDeviceStatus } from './DeviceStatus';
import { fullWidth, grow } from './layout';
import type {
  ButtonProps,
  ChoiceProps,
  LinkItemProps,
  ListItemProps,
  NumberProps,
  ScreenProps,
  TextFieldProps,
  ToggleProps,
} from './ui.types';

export type * from './ui.types';

/** A screen of sections, under its stack's native header bar, which says which device is connected. */
export function Screen({ title, noDeviceStatus, fill, children }: ScreenProps) {
  return (
    <>
      <Stack.Screen options={{ title, headerRight: noDeviceStatus ? undefined : () => <DeviceStatus /> }} />
      {fill ? (
        <View style={{ flex: 1 }}>{children}</View>
      ) : (
        <Host style={{ flex: 1 }} seedColor={theme.accent}>
          <FieldGroup>{children}</FieldGroup>
        </Host>
      )}
    </>
  );
}

/** In the header: the connected device, or a way to connect one. */
function DeviceStatus() {
  const status = useDeviceStatus();
  return (
    <Pressable onPress={status.go} hitSlop={8} accessibilityRole="button">
      <RNText style={{ color: theme.accent, fontSize: 15, fontWeight: '600' }}>{status.label}</RNText>
    </Pressable>
  );
}

/** A group of rows with an optional title. The group itself, not a wrapper: FieldGroup looks for it. */
export const Section = FieldGroup.Section;

export function Title({ children }: { children: string }) {
  return <Text textStyle={{ fontWeight: '600' }}>{children}</Text>;
}

export function Body({ children }: { children: string }) {
  return <Text>{children}</Text>;
}

/** Secondary text: hints, sizes, states. */
export function Muted({ children }: { children: string }) {
  return <Text textStyle={{ color: theme.muted, fontSize: 14 }}>{children}</Text>;
}

/** Set by `ListItem`: its buttons sit at the end of the row instead of taking the full width. */
const InRow = createContext(false);

export function Button({ label, onPress, variant = 'primary', disabled }: ButtonProps) {
  const inRow = useContext(InRow);
  const modifiers = inRow ? undefined : fullWidth;
  if (variant === 'danger') {
    return (
      <UiButton variant="text" disabled={disabled} onPress={onPress} modifiers={modifiers}>
        <Text textStyle={{ color: theme.danger }}>{label}</Text>
      </UiButton>
    );
  }
  const v = variant === 'primary' ? 'filled' : 'outlined';
  return <UiButton label={label} variant={v} disabled={disabled} onPress={onPress} modifiers={modifiers} />;
}

/** A row: title and detail, actions at its end. */
export function ListItem({ title, detail, children }: ListItemProps) {
  return (
    <Row spacing={8} alignment="center" style={{ paddingVertical: 6 }}>
      <Column spacing={2} alignment="start" modifiers={grow}>
        <Title>{title}</Title>
        {detail ? <Muted>{detail}</Muted> : null}
      </Column>
      {children ? <InRow.Provider value>{children}</InRow.Provider> : null}
    </Row>
  );
}

/** A row that opens another screen. */
export function LinkItem({ title, detail, onPress }: LinkItemProps) {
  return (
    <Row spacing={8} alignment="center" onPress={onPress} style={{ paddingVertical: 6 }}>
      <Column spacing={2} alignment="start">
        <Title>{title}</Title>
        {detail ? <Muted>{detail}</Muted> : null}
      </Column>
      <Spacer flexible />
      <Text textStyle={{ color: theme.muted, fontSize: 20 }}>›</Text>
    </Row>
  );
}

export function Toggle({ label, value, onChange, help }: ToggleProps) {
  return (
    <Column spacing={4} alignment="start">
      <Switch label={label} value={value} onValueChange={onChange} />
      {help ? <Muted>{help}</Muted> : null}
    </Column>
  );
}

export function NumberField({ label, value, min, max, step = 1, unit, onChange, help }: NumberProps) {
  return (
    <Column spacing={4} alignment="start">
      <Text>{`${label} : ${value}${unit ? ` ${unit}` : ''}`}</Text>
      <Slider
        value={value}
        min={min}
        max={max}
        // Compose draws a tick per step: only when there are few.
        step={(max - min) / step <= 20 ? step : undefined}
        onValueChange={(v) => onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)))}
      />
      {help ? <Muted>{help}</Muted> : null}
    </Column>
  );
}

export function Choice({ label, value, options, onChange, help }: ChoiceProps) {
  return (
    <Column spacing={4} alignment="start">
      <Text>{label}</Text>
      <Picker selectedValue={value} onValueChange={onChange}>
        {options.map((o) => (
          <Picker.Item key={o.value} label={o.label} value={o.value} />
        ))}
      </Picker>
      {help ? <Muted>{help}</Muted> : null}
    </Column>
  );
}

export function TextField({ label, value, onChange, help }: TextFieldProps) {
  return (
    <Column spacing={4} alignment="start">
      <Text>{label}</Text>
      <TextInput defaultValue={value} onChangeText={onChange} />
      {help ? <Muted>{help}</Muted> : null}
    </Column>
  );
}

/** A plain React Native view (a chart…) among the native rows, as wide as a row. */
export function Embed({ children }: { children: ReactElement }) {
  // The host gives its child no width of its own: set it (screen less the section's margins and padding).
  const { width } = useWindowDimensions();
  return (
    <RNHostView matchContents>
      <View style={{ width: width - 64 }}>{children}</View>
    </RNHostView>
  );
}
