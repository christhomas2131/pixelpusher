import fs from 'fs';
import { logger } from './logger';

export async function assertDriveReady(folderPath: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const stat = fs.statSync(folderPath);
      if (!stat.isDirectory()) {
        throw new Error(`Not a directory: ${folderPath}`);
      }
      return;
    } catch (err) {
      if (attempt < 2) {
        logger.warn('drive', `Drive not ready (attempt ${attempt + 1}/3), retrying in 15s`, folderPath);
        await new Promise(r => setTimeout(r, 15_000));
      } else {
        throw new Error(
          `Source drive is not ready: ${folderPath}. Open the folder in File Explorer to wake the drive.`
        );
      }
    }
  }
}
