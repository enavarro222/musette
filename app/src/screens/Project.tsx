import { Linking } from 'react-native';
import { Body, Button, LinkItem, Screen, Section } from '../components/ui';
import { reportError } from '../lib/store';

/** Set to your Ko-fi page to show the support button. */
const KOFI_URL = '';
const REPO = 'https://github.com/enavarro222/musette';
const FIRMWARE = 'https://github.com/enavarro222/opencc600';

const open = (url: string) => void Linking.openURL(url).catch(reportError);

export default function Project() {
  return (
    <Screen title="Projet">
      <Section>
        <Body>Musette est libre (MIT) et fonctionne sans compte ni serveur : vos sorties restent sur votre appareil.</Body>
      </Section>

      {KOFI_URL ? (
        <Section title="Soutenir le projet">
          <Body>Un café aide à financer le matériel de test et le temps de développement.</Body>
          <Button label="Soutenir sur Ko-fi" onPress={() => open(KOFI_URL)} />
        </Section>
      ) : null}

      <Section>
        <LinkItem title="Signaler un bug ou proposer une idée" onPress={() => open(`${REPO}/issues/new`)} />
        <LinkItem title="Code source de l’appli" detail="GitHub" onPress={() => open(REPO)} />
        <LinkItem title="Firmware OpenCC600" detail="GitHub" onPress={() => open(FIRMWARE)} />
      </Section>
    </Screen>
  );
}
