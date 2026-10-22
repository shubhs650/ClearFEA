// SPDX-License-Identifier: AGPL-3.0-or-later
// Saves a file the browser built or fetched through a temporary link (M3.8's run export, M13.4's
// admin export).

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Let the browser start the download before the data goes.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
