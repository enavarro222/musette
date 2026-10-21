import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import type { ReactNode } from 'react';

/** Line icons, 24×24, drawn in the label's colour (the same ideas as the native tabs'). */
const ICONS = {
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </>
  ),
  map: <path d="M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5L9 4zM9 4v13.5M15 6.5V20" />,
  bike: (
    <>
      <circle cx="5.5" cy="16.5" r="3.5" />
      <circle cx="18.5" cy="16.5" r="3.5" />
      <path d="M5.5 16.5 9 9h6.5l3 7.5M9 9l3.5 7.5h-7M15.5 9 14 5.5h-2.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

const TABS = [
  { name: '(activities)', href: '/', label: 'Sorties', icon: 'list' },
  { name: 'routes', href: '/routes', label: 'Traces', icon: 'map' },
  { name: 'device', href: '/device', label: 'Compteur', icon: 'bike' },
  { name: 'project', href: '/project', label: 'Projet', icon: 'info' },
] as const;

/** Web: the bottom navigation of the first web app. */
export default function TabsLayout() {
  return (
    <Tabs>
      <TabSlot />
      <TabList asChild>
        <nav aria-label="Navigation principale">
          {TABS.map((t) => (
            <TabTrigger key={t.name} name={t.name} href={t.href} asChild>
              <TabButton>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {ICONS[t.icon]}
                </svg>
                {t.label}
              </TabButton>
            </TabTrigger>
          ))}
        </nav>
      </TabList>
    </Tabs>
  );
}

function TabButton({ isFocused, children, onPress }: TabTriggerSlotProps) {
  return (
    <button
      type="button"
      className={isFocused ? 'active' : undefined}
      aria-current={isFocused ? 'page' : undefined}
      onClick={(e) => onPress?.(e as never)}
    >
      {children}
    </button>
  );
}
