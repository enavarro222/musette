/** Saving a file where the user keeps their files (Android: a folder they chose; web: downloads). */
export interface FileSaver {
  /** The button's words. */
  label: string;
  /** The remembered folder's name, undefined until one is chosen (or where none is: the web). */
  folder(): Promise<string | undefined>;
  /**
   * Save the file in the remembered folder; the first time, or with
   * `choose`, ask for one. Resolves to the folder's name, or undefined if the
   * user cancelled.
   */
  save(name: string, bytes: Uint8Array, choose?: boolean): Promise<string | undefined>;
}
