import path from "path";

import {loadPatientUuidsFromDir, loadPatientUuidsFromFile} from "./services/fileService.js";
import { exportPatient } from "./services/exporterService.js";
import logger from './utils/logger.js';
import config from './utils/config.js';

const SUCCESS_DIR = path.join(config.TARGET_DIR, 'successful');

const uuids = loadPatientUuidsFromDir(SUCCESS_DIR);

for (const uuid of uuids) {
  try {
    const patientRecord = await exportPatient(uuid);
    logger.info(`Patient ${uuid} verified successfully`);
  } catch (error) {
    logger.error("Failed verify patient ${uuid}:", error);
  }
}
