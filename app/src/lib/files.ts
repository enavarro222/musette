import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

/** Let the user pick a GPX file; its text, or undefined if cancelled. */
export async function pickGpx(): Promise<string | undefined> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled) return undefined;
  return new File(result.assets[0].uri).text();
}
