import JSZip from 'jszip';
import { normalizePath } from './machineDetector.js';

export async function readZipEntries(fileOrBlob, sourcePath, depth = 0, maxDepth = 6) {
  const warnings = [];
  const entries = [];

  if (depth > maxDepth) {
    warnings.push(`Skipped ${sourcePath}: nested zip depth exceeded ${maxDepth}.`);
    return { entries, warnings };
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(
      fileOrBlob?.arrayBuffer ? await fileOrBlob.arrayBuffer() : fileOrBlob
    );
  } catch (error) {
    return {
      entries,
      warnings: [`Unable to read zip archive ${sourcePath}: ${error.message}`]
    };
  }

  const zipEntries = Object.values(zip.files);
  for (const zipEntry of zipEntries) {
    const entryPath = normalizePath(`${sourcePath}/${zipEntry.name}`);
    entries.push({
      path: entryPath,
      name: zipEntry.name,
      sourcePath,
      isDirectory: zipEntry.dir,
      isArchive: !zipEntry.dir && zipEntry.name.toLowerCase().endsWith('.zip'),
      size: zipEntry._data?.uncompressedSize || 0,
      depth
    });

    if (!zipEntry.dir && zipEntry.name.toLowerCase().endsWith('.zip')) {
      try {
        const nestedBuffer = await zipEntry.async('arraybuffer');
        const nested = await readZipEntries(nestedBuffer, entryPath, depth + 1, maxDepth);
        entries.push(...nested.entries);
        warnings.push(...nested.warnings);
      } catch (error) {
        warnings.push(`Unable to inspect nested archive ${entryPath}: ${error.message}`);
      }
    }
  }

  return { entries, warnings };
}
