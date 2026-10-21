/** Ask before a destructive or irreversible action; resolves true to go on. */
export async function confirmAction(message: string, _action: string): Promise<boolean> {
  return window.confirm(message);
}

/** Tell the user something went wrong (the message is already in French). */
export function notify(message: string, onClose: () => void): void {
  window.alert(message);
  onClose();
}
