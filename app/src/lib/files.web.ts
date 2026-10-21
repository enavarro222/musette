import * as DocumentPicker from 'expo-document-picker';

/** Let the user pick a GPX file; its text, or undefined if cancelled. */
export async function pickGpx(): Promise<string | undefined> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['.gpx', 'application/gpx+xml'] });
  if (result.canceled) return undefined;
  const file = result.assets[0].file;
  return file ? file.text() : (await fetch(result.assets[0].uri)).text();
}
