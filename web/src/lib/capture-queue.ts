const databaseName = 'planner-ai-capture-queue';
const databaseVersion = 1;
const keyId = 'capture-key-v1';
const draftId = 'active-capture';
const sevenDays = 7 * 24 * 60 * 60 * 1_000;

type EncryptedValue = { iv: number[]; ciphertext: ArrayBuffer };
type StoredCapture = {
  id: string;
  text: EncryptedValue;
  source: 'typed' | 'voice';
  createdAt: string;
  attempts: number;
  nextRetryAt: string;
  lastErrorAt: string | null;
};
type StoredVoice = {
  id: string;
  audio: EncryptedValue;
  mimeType: string;
  createdAt: string;
  expiresAt: string;
};

export type QueuedCapture = Omit<StoredCapture, 'text'> & { rawText: string };
export type FailedVoice = Omit<StoredVoice, 'audio'>;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local storage request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Local storage failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Local storage stopped.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('captures')) {
        database.createObjectStore('captures', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('voice')) {
        database.createObjectStore('voice', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
      if (!database.objectStoreNames.contains('drafts')) database.createObjectStore('drafts');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local storage is unavailable.'));
  });
}

async function encryptionKey(database: IDBDatabase): Promise<CryptoKey> {
  const read = database.transaction('meta', 'readonly');
  const existing = await requestResult(read.objectStore('meta').get(keyId));
  await transactionDone(read);
  if (existing instanceof CryptoKey) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const write = database.transaction('meta', 'readwrite');
  write.objectStore('meta').put(key, keyId);
  await transactionDone(write);
  return key;
}

async function encrypt(key: CryptoKey, value: Uint8Array): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength
  ) as ArrayBuffer;
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: Array.from(iv), ciphertext };
}

async function decrypt(key: CryptoKey, value: EncryptedValue): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(value.iv) },
    key,
    value.ciphertext
  );
}

export async function saveCaptureDraft(rawText: string, source: 'typed' | 'voice') {
  const database = await openDatabase();
  const key = await encryptionKey(database);
  const transaction = database.transaction('drafts', 'readwrite');
  if (!rawText) {
    transaction.objectStore('drafts').delete(draftId);
  } else {
    transaction.objectStore('drafts').put(
      {
        text: await encrypt(key, new TextEncoder().encode(rawText)),
        source,
        updatedAt: new Date().toISOString(),
      },
      draftId
    );
  }
  await transactionDone(transaction);
  database.close();
}

export async function loadCaptureDraft(): Promise<{
  rawText: string;
  source: 'typed' | 'voice';
} | null> {
  const database = await openDatabase();
  const key = await encryptionKey(database);
  const transaction = database.transaction('drafts', 'readonly');
  const stored = (await requestResult(transaction.objectStore('drafts').get(draftId))) as
    | { text: EncryptedValue; source: 'typed' | 'voice' }
    | undefined;
  await transactionDone(transaction);
  database.close();
  if (!stored) return null;
  return {
    rawText: new TextDecoder().decode(await decrypt(key, stored.text)),
    source: stored.source,
  };
}

export async function queueCapture(
  id: string,
  rawText: string,
  source: 'typed' | 'voice'
): Promise<void> {
  const database = await openDatabase();
  const key = await encryptionKey(database);
  const now = new Date().toISOString();
  const stored: StoredCapture = {
    id,
    text: await encrypt(key, new TextEncoder().encode(rawText)),
    source,
    createdAt: now,
    attempts: 0,
    nextRetryAt: now,
    lastErrorAt: null,
  };
  const transaction = database.transaction(['captures', 'drafts'], 'readwrite');
  transaction.objectStore('captures').put(stored);
  transaction.objectStore('drafts').delete(draftId);
  await transactionDone(transaction);
  database.close();
}

export async function listQueuedCaptures(): Promise<QueuedCapture[]> {
  const database = await openDatabase();
  const key = await encryptionKey(database);
  const transaction = database.transaction('captures', 'readonly');
  const stored = (await requestResult(
    transaction.objectStore('captures').getAll()
  )) as StoredCapture[];
  await transactionDone(transaction);
  const captures = await Promise.all(
    stored.map(async (capture) => ({
      id: capture.id,
      source: capture.source,
      createdAt: capture.createdAt,
      attempts: capture.attempts,
      nextRetryAt: capture.nextRetryAt,
      lastErrorAt: capture.lastErrorAt,
      rawText: new TextDecoder().decode(await decrypt(key, capture.text)),
    }))
  );
  database.close();
  return captures.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function removeQueuedCapture(id: string) {
  const database = await openDatabase();
  const transaction = database.transaction('captures', 'readwrite');
  transaction.objectStore('captures').delete(id);
  await transactionDone(transaction);
  database.close();
}

export async function deferQueuedCapture(id: string, attempts: number) {
  const database = await openDatabase();
  const transaction = database.transaction('captures', 'readwrite');
  const store = transaction.objectStore('captures');
  const capture = (await requestResult(store.get(id))) as StoredCapture | undefined;
  if (capture) {
    const delay = Math.min(2 ** Math.min(attempts, 8) * 5_000, 15 * 60_000);
    store.put({
      ...capture,
      attempts,
      lastErrorAt: new Date().toISOString(),
      nextRetryAt: new Date(Date.now() + delay).toISOString(),
    });
  }
  await transactionDone(transaction);
  database.close();
}

export async function retainFailedVoice(audio: Blob): Promise<string> {
  const database = await openDatabase();
  const key = await encryptionKey(database);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const stored: StoredVoice = {
    id,
    audio: await encrypt(key, new Uint8Array(await audio.arrayBuffer())),
    mimeType: audio.type || 'audio/webm',
    createdAt,
    expiresAt: new Date(Date.now() + sevenDays).toISOString(),
  };
  const transaction = database.transaction('voice', 'readwrite');
  transaction.objectStore('voice').put(stored);
  await transactionDone(transaction);
  database.close();
  return id;
}

export async function readFailedVoice(id: string): Promise<Blob | null> {
  const database = await openDatabase();
  const key = await encryptionKey(database);
  const transaction = database.transaction('voice', 'readonly');
  const stored = (await requestResult(transaction.objectStore('voice').get(id))) as
    | StoredVoice
    | undefined;
  await transactionDone(transaction);
  database.close();
  if (!stored || stored.expiresAt <= new Date().toISOString()) return null;
  return new Blob([await decrypt(key, stored.audio)], { type: stored.mimeType });
}

export async function removeFailedVoice(id: string) {
  const database = await openDatabase();
  const transaction = database.transaction('voice', 'readwrite');
  transaction.objectStore('voice').delete(id);
  await transactionDone(transaction);
  database.close();
}

export async function listFailedVoices(): Promise<FailedVoice[]> {
  const database = await openDatabase();
  const transaction = database.transaction('voice', 'readwrite');
  const store = transaction.objectStore('voice');
  const records = (await requestResult(store.getAll())) as StoredVoice[];
  const now = new Date().toISOString();
  for (const record of records) if (record.expiresAt <= now) store.delete(record.id);
  await transactionDone(transaction);
  database.close();
  return records
    .filter((record) => record.expiresAt > now)
    .map((record) => ({
      id: record.id,
      mimeType: record.mimeType,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
