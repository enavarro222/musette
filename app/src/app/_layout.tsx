import { NativeTabs } from 'expo-router/native-tabs';
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { notify } from '../lib/ask';
import { listenForOpenedRoutes } from '../lib/opened';
import { appStore, useApp } from '../lib/store';
import { theme } from '../theme';

export default function Layout() {
  const { error, pendingRoute } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (error) notify(error, () => appStore.set({ error: undefined }));
  }, [error]);

  useEffect(() => listenForOpenedRoutes(), []);

  useEffect(() => {
    if (pendingRoute) router.navigate('/routes');
  }, [pendingRoute]);

  return (
    <NativeTabs tintColor={theme.accent}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Compteur</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bicycle" md="directions_bike" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="activities">
        <NativeTabs.Trigger.Label>Sorties</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet" md="list" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="routes">
        <NativeTabs.Trigger.Label>Traces</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="map" md="map" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="project">
        <NativeTabs.Trigger.Label>Projet</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="info.circle" md="info" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
