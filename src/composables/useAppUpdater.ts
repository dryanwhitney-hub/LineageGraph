import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater';

const currentVersion = ref<string>('');
const isChecking = ref<boolean>(false);
const isDownloading = ref<boolean>(false);
const downloadProgress = ref<number>(0);
const availableUpdate = ref<Update | null>(null);
const newVersion = ref<string>('');
const releaseNotes = ref<string>('');
const releaseDate = ref<string>('');
const statusMessage = ref<string | null>(null);
const statusType = ref<
  'idle' | 'checking' | 'up-to-date' | 'update-available' | 'offline' | 'error' | 'downloading'
>('idle');
const showConfirmModal = ref<boolean>(false);

export function useAppUpdater() {
  async function loadCurrentVersion(): Promise<string> {
    if (!currentVersion.value) {
      try {
        currentVersion.value = await getVersion();
      } catch {
        currentVersion.value = '0.2.1';
      }
    }
    return currentVersion.value;
  }

  async function isInternetAvailable(): Promise<boolean> {
    try {
      return await invoke<boolean>('check_internet_connection');
    } catch {
      return false;
    }
  }

  async function checkForUpdates(manual: boolean = false): Promise<boolean> {
    if (isChecking.value) return false;
    isChecking.value = true;
    statusType.value = 'checking';
    statusMessage.value = null;

    await loadCurrentVersion();

    try {
      const online = await isInternetAvailable();
      if (!online) {
        statusType.value = 'offline';
        if (manual) {
          statusMessage.value = 'offline';
        }
        isChecking.value = false;
        return false;
      }

      const update = await check();
      if (update) {
        availableUpdate.value = update;
        newVersion.value = update.version;
        releaseNotes.value = update.body || '';
        releaseDate.value = update.date || '';
        statusType.value = 'update-available';
        statusMessage.value = `update_available:${update.version}`;
        showConfirmModal.value = true;
        isChecking.value = false;
        return true;
      } else {
        availableUpdate.value = null;
        statusType.value = 'up-to-date';
        if (manual) {
          statusMessage.value = 'up_to_date';
        }
        isChecking.value = false;
        return false;
      }
    } catch (err: unknown) {
      statusType.value = 'error';
      if (manual) {
        statusMessage.value = err instanceof Error ? err.message : String(err);
      }
      isChecking.value = false;
      return false;
    }
  }

  async function confirmInstall(): Promise<void> {
    if (!availableUpdate.value) return;
    try {
      isDownloading.value = true;
      downloadProgress.value = 0;
      statusType.value = 'downloading';

      let downloaded = 0;
      let contentLength = 0;

      await availableUpdate.value.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength || 0;
          downloadProgress.value = 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            downloadProgress.value = Math.min(100, Math.round((downloaded / contentLength) * 100));
          }
        } else if (event.event === 'Finished') {
          downloadProgress.value = 100;
        }
      });
    } catch (err: unknown) {
      statusType.value = 'error';
      statusMessage.value = err instanceof Error ? err.message : String(err);
      isDownloading.value = false;
    }
  }

  function dismissConfirmModal() {
    showConfirmModal.value = false;
  }

  return {
    currentVersion,
    isChecking,
    isDownloading,
    downloadProgress,
    availableUpdate,
    newVersion,
    releaseNotes,
    releaseDate,
    statusMessage,
    statusType,
    showConfirmModal,
    loadCurrentVersion,
    isInternetAvailable,
    checkForUpdates,
    confirmInstall,
    dismissConfirmModal,
  };
}

