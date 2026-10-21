import { Button, FieldGroup, Text } from '@expo/ui';
import { Linking } from 'react-native';
import { Screen } from '../components/Screen';
import { reportError } from '../lib/store';

/** Set to your Ko-fi page to show the support button. */
const KOFI_URL = '';
const REPO = 'https://github.com/enavarro222/musette';
const FIRMWARE = 'https://github.com/enavarro222/opencc600';

const open = (url: string) => void Linking.openURL(url).catch(reportError);

export default function Project() {
  return (
    <Screen>
      <FieldGroup.Section title="Projet">
        <Text>
          Musette est libre (MIT) et fonctionne sans compte ni serveur : vos sorties restent sur votre appareil.
        </Text>
      </FieldGroup.Section>

      {KOFI_URL ? (
        <FieldGroup.Section title="Soutenir le projet">
          <Text>Un café aide à financer le matériel de test et le temps de développement.</Text>
          <Button label="Soutenir sur Ko-fi" onPress={() => open(KOFI_URL)} />
        </FieldGroup.Section>
      ) : null}

      <FieldGroup.Section>
        <Button label="Signaler un bug ou proposer une idée" variant="text" onPress={() => open(`${REPO}/issues/new`)} />
        <Button label="Code source de l’appli" variant="text" onPress={() => open(REPO)} />
        <Button label="Firmware OpenCC600" variant="text" onPress={() => open(FIRMWARE)} />
      </FieldGroup.Section>
    </Screen>
  );
}
