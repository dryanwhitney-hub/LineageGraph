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
    request.onerror = () => reject(request.error);
  });
}

export async function saveBackgroundImageToDB(
  dataUrl: string,
  fileName: string = 'background_image',
  fileType: string = 'image/png',
  fileSize: number = 0,
  key: string = BG_IMAGE_KEY
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const record: StoredBgImage = {
      dataUrl,
      fileName,
      fileType,
      fileSize,
      updatedAt: Date.now(),
    };
    const req = store.put(record, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadBackgroundImageFromDB(key: string = BG_IMAGE_KEY): Promise<StoredBgImage | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? (req.result as StoredBgImage) : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Could not load background image from IndexedDB:', e);
    return null;
  }
}

export async function deleteBackgroundImageFromDB(key: string = BG_IMAGE_KEY): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Could not delete background image from IndexedDB:', e);
  }
}

