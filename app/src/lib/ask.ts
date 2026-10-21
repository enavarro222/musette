import { Alert } from 'react-native';

/** Ask before a destructive or irreversible action; resolves true to go on. */
export function confirmAction(message: string, action: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert('Musette', message, [
      { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

/** Tell the user something went wrong (the message is already in French). */
export function notify(message: string, onClose: () => void): void {
  Alert.alert('Musette', message, [{ text: 'OK', onPress: onClose }], { onDismiss: onClose });
}
