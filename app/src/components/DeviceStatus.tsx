import { useRouter } from 'expo-router';
import { useApp } from '../lib/store';

/** The device the app is connected to, or none: in every screen's header. */
export function useDeviceStatus() {
  const { device, connecting } = useApp();
  const router = useRouter();
  return device
    ? { label: `● ${device.name}`, connected: true, go: () => router.navigate('/device') }
    : { label: connecting ? 'Connexion…' : 'Connecter', connected: false, go: () => router.push('/connect') };
}
