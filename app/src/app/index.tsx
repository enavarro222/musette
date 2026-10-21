import { useRouter } from 'expo-router';
import Devices from '../screens/Devices';

export default function DevicesTab() {
  const router = useRouter();
  return <Devices onSynced={() => router.navigate('/activities')} />;
}
