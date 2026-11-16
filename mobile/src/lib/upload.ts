/**
 * Adds a file from the phone to a multipart form.
 *
 * Expo's fetch (the one this app uses) can't send React Native's old `{ uri, name, type }` file parts, so an upload built that way
 * fails before any request is made and shows up as "Can't reach A-Zee". The file is read into a real Blob first instead.
 * The uri must be a file:// path, which is what the document picker and the camera module return.
 */
export async function appendFile(form: FormData, field: string, file: { uri: string; name: string; type: string }): Promise<void> {
  let blob: Blob;
  try {
    const res = await fetch(file.uri);
    blob = await res.blob();
  } catch {
    throw new Error("That file couldn't be read. It may have been moved or deleted, or the phone may be low on storage.");
  }
  if (!blob.size) throw new Error("That file is empty.");
  form.append(field, new Blob([blob], { type: file.type }), file.name);
}
