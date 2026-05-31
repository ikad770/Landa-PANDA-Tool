import { LOG_FILE_EXTENSIONS, SUPPORTED_SYSTEMS } from '../utils/constants.js';
import { detectMachineId, machineSort, normalizePath } from './machineDetector.js';
import { detectSystemsFromPath } from './systemDetector.js';
import { readZipEntries } from './zipScanner.js';

function createMachine(id) {
  return {
    id,
    sourceFiles: [],
    opcArchives: [],
    logFiles: [],
    detectedSystems: [],
    sampleLogs: [],
    scanWarnings: [],
    status: 'Pending inventory'
  };
}

function extension(path) {
  const lower = path.toLowerCase();
  return LOG_FILE_EXTENSIONS.find((ext) => lower.endsWith(ext));
}

function isLogPath(path) {
  const lower = normalizePath(path).toLowerCase();
  return lower.includes('/logs/') || lower.startsWith('logs/') || Boolean(extension(lower));
}

function isOpcArchive(path) {
  return normalizePath(path).toLowerCase().endsWith('/opc.zip') || normalizePath(path).toLowerCase() === 'opc.zip';
}

function addUnique(list, value, limit = 5000) {
  if (!value || list.includes(value) || list.length >= limit) return;
  list.push(value);
}

function getMachine(machinesById, machineId) {
  if (!machinesById.has(machineId)) machinesById.set(machineId, createMachine(machineId));
  return machinesById.get(machineId);
}

function assignEntry(entry, machinesById, aggregate) {
  if (entry.isDirectory) return;
  const path = normalizePath(entry.path);
  const machineId = detectMachineId(path);
  const machine = getMachine(machinesById, machineId);

  aggregate.files += 1;
  addUnique(machine.sourceFiles, entry.sourcePath || path, 200);

  const systems = detectSystemsFromPath(path);
  for (const system of systems) addUnique(machine.detectedSystems, system, SUPPORTED_SYSTEMS.length);

  if (isOpcArchive(path)) {
    aggregate.opcArchives += 1;
    addUnique(machine.opcArchives, path, 1000);
  }

  if (isLogPath(path)) {
    aggregate.logFiles += 1;
    addUnique(machine.logFiles, path, 5000);
    addUnique(machine.sampleLogs, path, 8);
  }
}

function finalize(machinesById, aggregate, errors) {
  const machines = [...machinesById.values()].map((machine) => ({
    ...machine,
    detectedSystems: machine.detectedSystems.sort(),
    status: machine.logFiles.length || machine.opcArchives.length ? 'Inventory ready' : 'No logs detected'
  })).sort(machineSort);

  const systems = new Set(machines.flatMap((machine) => machine.detectedSystems));

  return {
    machines,
    totals: {
      files: aggregate.files,
      machines: machines.length,
      opcArchives: aggregate.opcArchives,
      logFiles: aggregate.logFiles,
      systems: systems.size
    },
    errors
  };
}

export async function scanUploads(fileList) {
  const files = Array.from(fileList || []);
  const machinesById = new Map();
  const aggregate = { files: 0, opcArchives: 0, logFiles: 0 };
  const errors = [];

  if (files.length === 0) return finalize(machinesById, aggregate, errors);

  for (const file of files) {
    const relativePath = normalizePath(file.webkitRelativePath || file.name);
    const rootEntry = {
      path: relativePath,
      sourcePath: relativePath,
      isDirectory: false,
      isArchive: relativePath.toLowerCase().endsWith('.zip'),
      size: file.size,
      depth: 0
    };

    assignEntry(rootEntry, machinesById, aggregate);

    if (rootEntry.isArchive) {
      const zipResult = await readZipEntries(file, relativePath);
      for (const warning of zipResult.warnings) {
        const machine = getMachine(machinesById, detectMachineId(relativePath));
        addUnique(machine.scanWarnings, warning, 50);
      }
      for (const entry of zipResult.entries) assignEntry(entry, machinesById, aggregate);
    }
  }

  for (const machine of machinesById.values()) {
    if (machine.id === 'UNASSIGNED') {
      machine.scanWarnings.push('No S/D machine folder ID was detected for this upload group.');
    }
    if (!machine.detectedSystems.length && (machine.logFiles.length || machine.opcArchives.length)) {
      machine.scanWarnings.push('Logs were found, but no PANDA system key was identified from file paths.');
    }
  }

  return finalize(machinesById, aggregate, errors);
}
