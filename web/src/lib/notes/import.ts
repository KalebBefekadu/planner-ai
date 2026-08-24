export const maxImportedNoteBytes = 200_000;
export const maxImportedNoteCharacters = 50_000;

export function validateNoteImport(fileName: string, contents: string) {
  const normalizedName = fileName.trim();
  if (normalizedName.length < 1 || normalizedName.length > 255) {
    throw new Error('Choose a file with a valid name.');
  }
  if (!/\.(md|markdown|txt)$/i.test(normalizedName)) {
    throw new Error('Import a Markdown or plain-text file.');
  }
  if (contents.includes('\0')) throw new Error('This file contains unsupported control data.');
  if (new TextEncoder().encode(contents).byteLength > maxImportedNoteBytes) {
    throw new Error('Keep imported files under 200 KB.');
  }
  if (contents.length > maxImportedNoteCharacters) {
    throw new Error('Keep imported Notes under 50,000 characters.');
  }
  const title =
    normalizedName
      .replace(/\.(md|markdown|txt)$/i, '')
      .replaceAll(/[_-]+/g, ' ')
      .trim()
      .slice(0, 300) || 'Imported Note';
  return { title, bodyMarkdown: contents };
}
