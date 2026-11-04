let recoverySequence = 0;

const recoveryMessage = 'A previous browser save could not be opened. Download its recovery file before making further changes.';

function previousRecovery(storage, key) {
  const pointer = storage.getItem(`${key}-recovery`);
  if (!pointer?.startsWith(`${key}-recovery-`)) return null;
  const raw = storage.getItem(pointer);
  return raw === null ? null : { raw, message: recoveryMessage };
}

function preserveInvalidSave(storage, key, raw) {
  let backupKey;
  do {
    backupKey = `${key}-recovery-${Date.now().toString(36)}-${(recoverySequence++).toString(36)}`;
  } while (storage.getItem(backupKey) !== null);
  storage.setItem(backupKey, raw);
  storage.setItem(`${key}-recovery`, backupKey);
}

/** Never replace an invalid autosave until its exact bytes have a durable recovery key. */
export function loadStoredProject(storage, key, normalize, createDefault) {
  let raw;
  try { raw = storage.getItem(key); }
  catch { return { project: createDefault(), recovery: null, autosaveBlocked: true }; }

  if (raw !== null) {
    try {
      const project = normalize(JSON.parse(raw));
      try { return { project, recovery: previousRecovery(storage, key), autosaveBlocked: false }; }
      catch { return { project, recovery: null, autosaveBlocked: true }; }
    } catch {
      let autosaveBlocked = false;
      try { preserveInvalidSave(storage, key, raw); }
      catch { autosaveBlocked = true; }
      return { project: createDefault(), recovery: { raw, message: recoveryMessage }, autosaveBlocked };
    }
  }

  try { return { project: createDefault(), recovery: previousRecovery(storage, key), autosaveBlocked: false }; }
  catch { return { project: createDefault(), recovery: null, autosaveBlocked: true }; }
}
