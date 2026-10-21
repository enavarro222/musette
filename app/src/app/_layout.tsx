import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { notify } from '../lib/ask';
import { importRoute } from '../lib/library';
import { listenForOpenedRoutes } from '../lib/opened';
import { appStore, reportError, useApp } from '../lib/store';
import { theme } from '../theme';

/** The navigator's colours: the phone's light or dark theme, Musette's accent. */
function useNavigationTheme() {
  const base = useColorScheme() === 'dark' ? DarkTheme : DefaultTheme;
  // The web page has its own background (musette.css), not the navigator's.
  const background = Platform.OS === 'web' ? 'transparent' : base.colors.background;
  return { ...base, colors: { ...base.colors, primary: theme.accent, background } };
}

/** The tabs, and above them the device chooser. */
export default function Layout() {
  const { error, pendingRoute } = useApp();
  const router = useRouter();
  const navigationTheme = useNavigationTheme();

  useEffect(() => {
    if (error) notify(error, () => appStore.set({ error: undefined }));
  }, [error]);

  useEffect(() => listenForOpenedRoutes(), []);

  // A GPX handed over by the OS joins the routes, then opens.
  useEffect(() => {
    if (!pendingRoute) return;
    appStore.set({ pendingRoute: undefined });
    importRoute(pendingRoute)
      .then((r) => router.navigate(`/routes/${r.id}`))
      .catch(reportError);
  }, [pendingRoute]);

  return (
    <ThemeProvider value={navigationTheme}>
      {/* The web shows its own heading and back link (`ui.web.tsx`). */}
      <Stack screenOptions={{ headerTintColor: theme.accent, headerShown: Platform.OS !== 'web' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="connect" options={{ presentation: 'modal', title: 'Connecter un compteur' }} />
      </Stack>
    </ThemeProvider>
  );
}
