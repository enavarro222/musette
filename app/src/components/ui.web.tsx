/**
 * Musette's UI kit, web: plain HTML and `musette.css` (the look of the first
 * web app). Same API as `ui.tsx` (iOS, Android).
 */
import { useNavigation, usePathname, useRoute, useRouter } from 'expo-router';
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { useDeviceStatus } from './DeviceStatus';
import './musette.css';
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

export function Screen({ title, noDeviceStatus, children }: ScreenProps) {
  return (
    <main>
      <Back />
      <header className="screen-head">
        <h1>{title}</h1>
        {noDeviceStatus ? null : <DeviceStatus />}
      </header>
      {children}
    </main>
  );
}

/** The tabs' first screens: no way back from them. */
const TAB_ROOTS = ['/', '/routes', '/device', '/project'];

/**
 * Web: no native header bar, so a link back on every screen but the tabs'
 * first ones. When the screen is the first of its stack (opened from a
 * shared link), it goes to the parent page instead.
 */
function Back() {
  const navigation = useNavigation();
  const route = useRoute();
  const router = useRouter();
  // The visible screen's path: hidden screens of the stack render too, but are not seen.
  const path = usePathname();
  if (TAB_ROOTS.includes(path)) return null;
  const first = navigation.getState()?.routes[0]?.key === route.key;
  return (
    <button
      type="button"
      className="back"
      onClick={() => (first ? router.replace((path.slice(0, path.lastIndexOf('/')) || '/') as never) : router.back())}
    >
      ‹ Retour
    </button>
  );
}

/** Next to the title: the connected device, or a way to connect one. */
function DeviceStatus() {
  const status = useDeviceStatus();
  return (
    <button type="button" className={`device-status${status.connected ? ' connected' : ''}`} onClick={status.go}>
      {status.label}
    </button>
  );
}

export function Section({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <section className="card">
      {title ? <div className="title">{title}</div> : null}
      {children}
    </section>
  );
}

export function Title({ children }: { children: string }) {
  return <div className="title">{children}</div>;
}

export function Body({ children }: { children: string }) {
  return <p>{children}</p>;
}

export function Muted({ children }: { children: string }) {
  return <p className="muted">{children}</p>;
}

/** Set by `ListItem`: its buttons sit at the end of the row instead of taking the full width. */
const InRow = createContext(false);

export function Button({ label, onPress, variant = 'primary', disabled }: ButtonProps) {
  const inRow = useContext(InRow);
  return (
    <button type="button" className={`${variant}${inRow ? '' : ' block'}`} disabled={disabled} onClick={onPress}>
      {label}
    </button>
  );
}

export function ListItem({ title, detail, children }: ListItemProps) {
  return (
    <div className="row">
      <div className="grow">
        <div className="title">{title}</div>
        {detail ? <span className="muted small">{detail}</span> : null}
      </div>
      {children ? <InRow.Provider value>{children}</InRow.Provider> : null}
    </div>
  );
}

export function LinkItem({ title, detail, onPress }: LinkItemProps) {
  return (
    <button type="button" className="row link-item" onClick={onPress}>
      <div className="grow">
        <div className="title">{title}</div>
        {detail ? <span className="muted small">{detail}</span> : null}
      </div>
      <span className="muted">›</span>
    </button>
  );
}

function Setting({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="row setting">
      <div className="grow">
        <span>{label}</span>
        {help ? <span className="muted small">{help}</span> : null}
      </div>
      {children}
    </label>
  );
}

export function Toggle({ label, value, onChange, help }: ToggleProps) {
  return (
    <Setting label={label} help={help}>
      <input type="checkbox" className="switch" checked={value} onChange={(e) => onChange(e.currentTarget.checked)} />
    </Setting>
  );
}

export function NumberField({ label, value, min, max, step = 1, unit, onChange, help }: NumberProps) {
  return (
    <Setting label={label} help={help}>
      <span className="number">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = e.currentTarget.valueAsNumber;
            if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
        {unit ? <span className="muted">{unit}</span> : null}
      </span>
    </Setting>
  );
}

export function Choice({ label, value, options, onChange, help }: ChoiceProps) {
  return (
    <Setting label={label} help={help}>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Setting>
  );
}

export function TextField({ label, value, onChange, help }: TextFieldProps) {
  return (
    <Setting label={label} help={help}>
      <input type="text" value={value} onChange={(e) => onChange(e.currentTarget.value)} />
    </Setting>
  );
}

export function Embed({ children }: { children: ReactElement }) {
  return children;
}
