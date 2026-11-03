/**
 * Utility for persisting the Design Mode background image in IndexedDB.
 * This avoids localStorage size limits (usually 5MB) for large JPG/PNG/SVG images.
 */

const DB_NAME = 'stammbaum_design_db';
const DB_VERSION = 1;
const STORE_NAME = 'bg_images';
const BG_IMAGE_KEY = 'design_mode_background';

export interface StoredBgImage {
  dataUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  updatedAt: number;
}

/**
 * Opens a connection to the IndexedDB database, creating the object store if needed.
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB open request was blocked'));
  });
}

/**
 * Executes a transaction against the background image object store and guarantees
 * that the database connection is closed once the transaction finishes.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    let requestResult: T;
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = operation(store);

    req.onsuccess = () => {
      requestResult = req.result;
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB request failed'));
    };

    tx.oncomplete = () => {
      db.close();
      resolve(requestResult);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    };
  });
}

/**
 * Persists a background image record in IndexedDB.
 */
export async function saveBackgroundImageToDB(
  dataUrl: string,
  fileName: string = 'background_image',
  fileType: string = 'image/png',
  fileSize: number = 0,
  key: string = BG_IMAGE_KEY
): Promise<void> {
  const record: StoredBgImage = {
    dataUrl,
    fileName,
    fileType,
    fileSize,
    updatedAt: Date.now(),
  };
  await withStore('readwrite', store => store.put(record, key));
}

/**
 * Loads a previously persisted background image record from IndexedDB.
 */
export async function loadBackgroundImageFromDB(key: string = BG_IMAGE_KEY): Promise<StoredBgImage | null> {
  try {
    const result = await withStore<StoredBgImage | undefined>('readonly', store => store.get(key));
    return result ?? null;
  } catch (e) {
    console.warn('Could not load background image from IndexedDB:', e);
    return null;
  }
}

/**
 * Deletes a persisted background image record from IndexedDB.
 */
export async function deleteBackgroundImageFromDB(key: string = BG_IMAGE_KEY): Promise<void> {
  try {
    await withStore('readwrite', store => store.delete(key));
  } catch (e) {
    console.warn('Could not delete background image from IndexedDB:', e);
  }
}


